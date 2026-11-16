"""Authenticated proxy endpoints for the documented WABOX provider APIs.

Provider credentials are read only by Django from its environment. Request
payloads and authorization headers are never written to the audit table.
"""

import json
import os
import re
from datetime import datetime, timezone as datetime_timezone
from urllib.parse import urlsplit

import requests
from django.conf import settings
from django.core import signing
from django.utils.crypto import constant_time_compare
from django.utils import timezone
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.response import Response

from .models import ProviderApiAudit, ProviderSyncState, ProviderTemplateCache, ProviderWebhookEvent, User
from .panel_tokens import load_panel_user

DEFAULT_PROVIDER_BASE_URL = "https://wbbox.infrainfotech.com"
PROVIDER_TIMEOUT_SECONDS = 25
SAFE_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,160}$")


def _panel_user(request):
    """Validate the short-lived Django-signed token issued at login."""
    if not settings.SECRET_KEY or settings.SECRET_KEY.startswith("django-insecure"):
        return None, Response({"error": "Configure a strong DJANGO_SECRET_KEY before enabling provider routes."}, status=503)
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None, Response({"error": "Panel authentication required."}, status=401)
    try:
        max_age = max(60, int(os.environ.get("PANEL_TOKEN_MAX_AGE", "86400")))
        user = load_panel_user(token, max_age)
    except (signing.BadSignature, signing.SignatureExpired, User.DoesNotExist, TypeError, ValueError):
        return None, Response({"error": "Panel session expired or invalid."}, status=401)
    return user, None


def _provider_settings():
    return {
        "base_url": os.environ.get("WBOX_API_BASE_URL", DEFAULT_PROVIDER_BASE_URL).rstrip("/"),
        "token": os.environ.get("WBOX_API_TOKEN", "").strip(),
        "version": os.environ.get("WBOX_META_VERSION", "").strip(),
        "waba_id": os.environ.get("WBOX_WABA_ID", "").strip(),
        "phone_number_id": os.environ.get("WBOX_PHONE_NUMBER_ID", "").strip(),
    }


def _configured(settings, needs_meta=False, needs_waba=False, needs_phone=False):
    try:
        parsed_base = urlsplit(settings["base_url"])
    except ValueError:
        return "WBOX_API_BASE_URL is invalid."
    if (parsed_base.scheme != "https" or not parsed_base.netloc or parsed_base.username or
            parsed_base.password or parsed_base.query or parsed_base.fragment):
        return "WBOX_API_BASE_URL must be an HTTPS URL without embedded credentials or query values."
    if not settings["token"]:
        return "WBOX_API_TOKEN is not configured on the server."
    if needs_meta and not settings["version"]:
        return "WBOX_META_VERSION is not configured on the server."
    if needs_meta and not re.fullmatch(r"v\d+\.\d+", settings["version"]):
        return "WBOX_META_VERSION must use the documented vN.N format."
    if needs_waba and not settings["waba_id"]:
        return "WBOX_WABA_ID is not configured on the server."
    if needs_waba and not SAFE_ID.fullmatch(settings["waba_id"]):
        return "WBOX_WABA_ID has an invalid format."
    if needs_phone and not settings["phone_number_id"]:
        return "WBOX_PHONE_NUMBER_ID is not configured on the server."
    if needs_phone and not SAFE_ID.fullmatch(settings["phone_number_id"]):
        return "WBOX_PHONE_NUMBER_ID has an invalid format."
    return ""


def _record(user, operation, method, status_code=None, succeeded=False, safe_message=""):
    try:
        ProviderApiAudit.objects.create(
            user=user,
            operation=operation,
            method=method,
            status_code=status_code,
            succeeded=succeeded,
            safe_message=safe_message[:240],
        )
    except Exception:
        # Auditing must not turn a successful upstream operation into a failure.
        pass


def _redact(value, secret):
    if isinstance(value, str):
        return value.replace(secret, "[redacted]") if secret else value
    if isinstance(value, list):
        return [_redact(item, secret) for item in value]
    if isinstance(value, dict):
        safe = {}
        for key, item in value.items():
            safe_key = key.replace(secret, "[redacted]") if secret and isinstance(key, str) else key
            safe[safe_key] = _redact(item, secret)
        return safe
    return value


def _call(user, operation, method, path, *, params=None, payload=None, files=None,
          needs_meta=False, needs_waba=False, needs_phone=False):
    settings = _provider_settings()
    configuration_error = _configured(settings, needs_meta, needs_waba, needs_phone)
    if configuration_error:
        _record(user, operation, method, safe_message="configuration_missing")
        return Response({"error": configuration_error, "operation": operation}, status=503)

    url = f"{settings['base_url']}/{path.lstrip('/')}"
    headers = {"Authorization": f"Bearer {settings['token']}", "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"

    try:
        response = requests.request(
            method,
            url,
            headers=headers,
            params=params,
            json=payload,
            files=files,
            timeout=PROVIDER_TIMEOUT_SECONDS,
        )
    except requests.RequestException:
        _record(user, operation, method, safe_message="provider_transport_error")
        return Response({"error": "Provider request failed. Check server connectivity and provider availability.",
                         "operation": operation}, status=502)

    try:
        body = _redact(response.json(), settings["token"])
    except (ValueError, json.JSONDecodeError):
        body = response.text[:4000]
        if settings["token"]:
            body = body.replace(settings["token"], "[redacted]")
    safe_message = "completed" if response.ok else "provider_rejected"
    _record(user, operation, method, response.status_code, response.ok, safe_message)

    if operation == "templates_sync":
        status = "success" if response.ok else "failed"
        safe = "Sync completed." if response.ok else "Provider rejected the sync request."
        sync_defaults = {"status": status, "safe_message": safe}
        if response.ok:
            sync_defaults["last_synced_at"] = timezone.now()
        ProviderSyncState.objects.update_or_create(
            name="whatsapp_templates",
            defaults=sync_defaults,
        )

    return Response({"operation": operation, "data": body}, status=response.status_code)


def _active_user(request):
    return _panel_user(request)


def _admin_required(user):
    if user.role != "admin":
        return Response({"error": "This provider operation requires an admin account."}, status=403)
    return None


def _valid_id(value):
    text = str(value or "").strip()
    return text if SAFE_ID.fullmatch(text) else ""


def _cache_provider_templates(items):
    for item in items or []:
        if not isinstance(item, dict):
            continue
        external_id = _valid_id(item.get("id"))
        name = str(item.get("name") or "").strip()
        if not external_id or not name:
            continue
        content = item.get("content")
        ProviderTemplateCache.objects.update_or_create(
            external_id=external_id,
            defaults={
                "template_id": str(item.get("template_id") or "")[:160],
                "name": name[:255],
                "language": str(item.get("language") or "")[:32],
                "category_name": str(item.get("category_name") or item.get("category") or "")[:80],
                "state": str(item.get("state") or "")[:40],
                "content": content if isinstance(content, dict) else {},
                "provider_created_at": str(item.get("created_at") or "")[:64],
                "provider_updated_at": str(item.get("updated_at") or "")[:64],
            },
        )


@api_view(["GET"])
def provider_status(request):
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    settings = _provider_settings()
    sync = ProviderSyncState.objects.filter(name="whatsapp_templates").first()
    return Response({
        "provider": "WABOX",
        "configured": not bool(_configured(settings)),
        "base_url": settings["base_url"],
        "meta_configured": not bool(_configured(settings, needs_meta=True, needs_waba=True, needs_phone=True)),
        "required_environment": ["WBOX_API_TOKEN", "WBOX_META_VERSION", "WBOX_WABA_ID", "WBOX_PHONE_NUMBER_ID"],
        "templates_last_synced_at": sync.last_synced_at.isoformat() if sync and sync.last_synced_at else None,
        "templates_sync_status": sync.status if sync else "not_synced",
    })


@api_view(["POST"])
@parser_classes([JSONParser])
def provider_webhook_inbound(request):
    """Receive callbacks using a separately configured shared secret.

    Store only event identifiers and types because webhook message bodies can
    contain personal data. The provider's documented outbound webhook API is
    still available through provider_dispatch(operation=webhook).
    """
    secret = os.environ.get("WBOX_WEBHOOK_SECRET", "").strip()
    authorization = request.headers.get("Authorization", "")
    scheme, _, supplied = authorization.partition(" ")
    if not secret or scheme.lower() != "bearer" or not constant_time_compare(secret, supplied):
        return Response({"error": "Webhook authentication failed."}, status=401)
    payload = request.data
    if not isinstance(payload, dict) or not payload:
        return Response({"error": "Webhook payload must be a non-empty JSON object."}, status=400)
    event_id = str(payload.get("event_id") or payload.get("id") or "")[:160]
    event_type = str(payload.get("event_type") or payload.get("type") or "")[:120]
    ProviderWebhookEvent.objects.create(event_id=event_id, event_type=event_type)
    return Response({"status": "accepted", "event_id": event_id or None}, status=202)


@api_view(["POST"])
@parser_classes([JSONParser])
def provider_dispatch(request):
    """Wallet and the three marketing integrations plus provider webhook."""
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    operation = str(request.data.get("operation", "")).strip().lower()
    routes = {
        "balance": ("GET", "/api/v1/user/balance"),
        "clevertap": ("POST", "/api/v1/meta/clevertap"),
        "moengage": ("POST", "/api/v1/meta/moengage"),
        "webengage": ("POST", "/api/v1/meta/webengage"),
        "webhook": ("POST", "/api/v1/meta/webhook"),
    }
    if operation not in routes:
        return Response({"error": "Unknown provider operation."}, status=400)
    method, path = routes[operation]
    payload = request.data.get("payload")
    if method == "POST" and not isinstance(payload, dict):
        return Response({"error": "payload must be a JSON object."}, status=400)
    return _call(user, operation, method, path, payload=payload)


@api_view(["GET"])
def provider_templates(request):
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    params = {}
    for key in ("page", "limit", "start_date", "end_date", "template_name"):
        if key in request.query_params:
            params[key] = request.query_params[key]
    for key in ("page", "limit"):
        if key in params:
            try:
                params[key] = int(params[key])
            except (TypeError, ValueError):
                return Response({"error": f"{key} must be an integer."}, status=400)
            if params[key] < 1 or (key == "limit" and params[key] > 200):
                return Response({"error": f"{key} is outside the allowed range."}, status=400)
    response = _call(user, "templates_list", "GET", "/api/v1/meta/templates", params=params)
    if response.status_code < 300:
        provider_data = response.data.get("data")
        items = provider_data.get("templates", []) if isinstance(provider_data, dict) else []
        _cache_provider_templates(items)
    return response


@api_view(["POST"])
@parser_classes([JSONParser])
def provider_template_sync(request):
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    payload = request.data or {}
    params = {key: payload[key] for key in ("startDate", "endDate") if payload.get(key)}
    try:
        parsed = {key: datetime.fromisoformat(value.replace("Z", "+00:00")) for key, value in params.items()}
        parsed = {key: value.replace(tzinfo=datetime_timezone.utc) if value.tzinfo is None else value
                  for key, value in parsed.items()}
    except (TypeError, ValueError):
        return Response({"error": "startDate and endDate must be valid ISO 8601 date-times."}, status=400)
    if "startDate" in parsed and "endDate" in parsed and parsed["startDate"] > parsed["endDate"]:
        return Response({"error": "startDate must be before or equal to endDate."}, status=400)
    return _call(user, "templates_sync", "POST", "/api/v1/meta/templates/sync", params=params, payload={})


@api_view(["GET"])
def provider_template_detail(request, template_id):
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    template_id = _valid_id(template_id)
    if not template_id:
        return Response({"error": "Invalid template ID."}, status=400)
    response = _call(user, "template_detail", "GET", f"/api/v1/meta/templates/{template_id}")
    if response.status_code < 300:
        item = response.data.get("data")
        if isinstance(item, dict):
            _cache_provider_templates([item])
    return response


@api_view(["GET", "POST", "DELETE"])
@parser_classes([JSONParser])
def provider_meta_templates(request):
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    settings = _provider_settings()
    config_error = _configured(settings, needs_meta=True, needs_waba=True)
    if config_error:
        _record(user, "meta_templates", request.method, safe_message="configuration_missing")
        return Response({"error": config_error}, status=503)
    path = f"/{settings['version']}/{settings['waba_id']}/message_templates"

    if request.method == "GET":
        params = {key: request.query_params[key] for key in ("limit", "after") if key in request.query_params}
        if "limit" in params:
            try:
                params["limit"] = int(params["limit"])
            except ValueError:
                return Response({"error": "limit must be an integer."}, status=400)
            if not 1 <= params["limit"] <= 200:
                return Response({"error": "limit must be between 1 and 200."}, status=400)
        return _call(user, "meta_templates_list", "GET", path, params=params, needs_meta=True, needs_waba=True)
    if request.method == "POST":
        payload = request.data.get("payload")
        if not isinstance(payload, dict) or not payload.get("name") or not payload.get("language") or not payload.get("category"):
            return Response({"error": "Template payload requires name, language and category."}, status=400)
        return _call(user, "meta_template_create", "POST", path, payload=payload, needs_meta=True, needs_waba=True)

    hsm_id = request.query_params.get("hsm_id", "").strip()
    name = request.query_params.get("name", "").strip()
    if not hsm_id.isdigit() or not name:
        return Response({"error": "DELETE requires numeric hsm_id and name."}, status=400)
    return _call(user, "meta_template_delete", "DELETE", path,
                 params={"hsm_id": hsm_id, "name": name}, needs_meta=True, needs_waba=True)


@api_view(["GET"])
def provider_meta_resource(request, resource_id):
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    resource_id = _valid_id(resource_id)
    if not resource_id:
        return Response({"error": "Invalid resource ID."}, status=400)
    settings = _provider_settings()
    params = {}
    phone_number_id = request.query_params.get("phone_number_id")
    if phone_number_id:
        safe_phone_id = _valid_id(phone_number_id)
        if not safe_phone_id:
            return Response({"error": "Invalid phone_number_id."}, status=400)
        if safe_phone_id != _provider_settings()["phone_number_id"]:
            return Response({"error": "phone_number_id does not match the configured provider account."}, status=400)
        params["phone_number_id"] = safe_phone_id
    return _call(user, "meta_resource_get", "GET", f"/{settings['version']}/{resource_id}",
                 params=params, needs_meta=True)


@api_view(["POST"])
@parser_classes([JSONParser])
def provider_meta_template_edit(request, template_id):
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    template_id = _valid_id(template_id)
    payload = request.data.get("payload")
    if not template_id or not isinstance(payload, dict) or not payload:
        return Response({"error": "A valid template ID and non-empty JSON payload are required."}, status=400)
    settings = _provider_settings()
    return _call(user, "meta_template_edit", "POST", f"/{settings['version']}/{template_id}",
                 payload=payload, needs_meta=True)


@api_view(["GET"])
def provider_meta_channels(request):
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    settings = _provider_settings()
    return _call(user, "meta_channels", "GET", f"/{settings['version']}/channels", needs_meta=True)


@api_view(["POST"])
@parser_classes([JSONParser])
def provider_meta_message(request):
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    payload = request.data.get("payload")
    to_number = re.sub(r"[\s()-]", "", str(request.data.get("to_number", "")).strip())
    if not to_number or not isinstance(payload, dict) or not payload:
        return Response({"error": "to_number and a non-empty JSON message payload are required."}, status=400)
    if not re.fullmatch(r"\+?\d{7,15}", to_number):
        return Response({"error": "to_number must use international phone number format."}, status=400)
    settings = _provider_settings()
    number_id = _valid_id(settings["phone_number_id"])
    if not number_id:
        return Response({"error": "WBOX_PHONE_NUMBER_ID is missing or invalid."}, status=503)
    if "to" in payload and re.sub(r"[\s()-]", "", str(payload["to"])) != to_number:
        return Response({"error": "payload.to must match to_number."}, status=400)
    payload = {**payload, "to": to_number}
    return _call(user, "meta_message_send", "POST", f"/{settings['version']}/{number_id}/messages",
                 payload=payload, needs_meta=True, needs_phone=True)


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def provider_meta_media(request):
    user, error = _active_user(request)
    if error:
        return error
    denied = _admin_required(user)
    if denied:
        return denied
    upload = request.FILES.get("file")
    if not upload:
        return Response({"error": "Multipart field 'file' is required."}, status=400)
    if upload.size > 16 * 1024 * 1024:
        return Response({"error": "Media upload exceeds the 16 MiB limit."}, status=413)
    content_type = upload.content_type or "application/octet-stream"
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4", "audio/mpeg", "audio/ogg", "application/pdf"}
    if content_type not in allowed_types:
        return Response({"error": "Unsupported media type."}, status=415)
    settings = _provider_settings()
    number_id = _valid_id(settings["phone_number_id"])
    if not number_id:
        return Response({"error": "WBOX_PHONE_NUMBER_ID is missing or invalid."}, status=503)
    files = {"file": (upload.name, upload, content_type)}
    return _call(user, "meta_media_upload", "POST", f"/{settings['version']}/{number_id}/media",
                 files=files, needs_meta=True, needs_phone=True)

