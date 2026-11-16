"""
views.py — WhatsApp Campaign Platform
Django REST API — Production Grade
"""

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.decorators import throttle_classes
from django.db import transaction
from django.core import signing
from django.contrib.auth.hashers import check_password, make_password
from django.utils.crypto import constant_time_compare
from django.conf import settings
import os
import hashlib
import json
import re
import hmac
from datetime import timedelta
from django.db import IntegrityError
from django.utils import timezone
from .models import User, Campaign, CampaignCallbackEvent, CreditLog, PanelLoginThrottle
from .panel_tokens import issue_panel_token, load_panel_user


# ══════════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════════

# Numbers <= this are sent instantly by the Node server.
# Numbers > this go into the admin-approval / "pending" queue.
# NOTE: keep this in sync with QUEUE_THRESHOLD  the Node server's
# CFG object, and with QUEUE_THRESHOLD in the React components.
QUEUE_THRESHOLD = 20
RECIPIENT_FINAL_STATUSES = {"sent", "failed", "nonwa"}


# ══════════════════════════════════════════════════════════════════
# PRIVATE HELPERS
# ══════════════════════════════════════════════════════════════════

def _panel_user(request):
    """Return the active actor represented by the signed token issued at login."""
    if not settings.SECRET_KEY or settings.SECRET_KEY.startswith("django-insecure"):
        return None, Response({"status": "error", "message": "Panel authentication is not configured."}, status=503)
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None, Response({"status": "failed", "message": "Authentication required."}, status=401)
    try:
        max_age = max(60, int(os.environ.get("PANEL_TOKEN_MAX_AGE", "86400")))
        actor = load_panel_user(token, max_age)
    except (signing.BadSignature, signing.SignatureExpired, User.DoesNotExist, TypeError, ValueError):
        return None, Response({"status": "failed", "message": "Panel session expired or invalid."}, status=401)
    return actor, None


def _target_user(actor, target_id=None, *, allow_self=True):
    """Resolve an optional target and enforce the panel's direct-child hierarchy."""
    if target_id in (None, ""):
        target = actor
    else:
        try:
            target = User.objects.select_related("parent").get(pk=target_id)
        except (User.DoesNotExist, TypeError, ValueError):
            return None, Response({"status": "failed", "message": "User not found"}, status=404)
    permitted = target.pk == actor.pk and allow_self
    permitted = permitted or (actor.role == "admin" and (allow_self or target.pk != actor.pk))
    permitted = permitted or (actor.role == "reseller" and target.parent_id == actor.pk)
    if not permitted:
        return None, Response({"status": "failed", "message": "Permission denied."}, status=403)
    return target, None


def _require_actor(request):
    return _panel_user(request)


class PanelLoginRateThrottle(SimpleRateThrottle):
    """Cross-process per-IP login throttle backed by Django's database."""

    scope = "login"

    def allow_request(self, request, view):
        identity = self.get_ident(request) or "unknown"
        key_digest = hmac.new(
            settings.SECRET_KEY.encode("utf-8"),
            identity.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        now = timezone.now()
        with transaction.atomic():
            PanelLoginThrottle.objects.get_or_create(
                key_digest=key_digest,
                defaults={"window_started_at": now, "attempts": 0},
            )
            bucket = PanelLoginThrottle.objects.select_for_update().get(pk=key_digest)
            if bucket.window_started_at + timedelta(seconds=self.duration) <= now:
                bucket.window_started_at = now
                bucket.attempts = 0
            if bucket.attempts >= self.num_requests:
                self._wait = max(1, (bucket.window_started_at + timedelta(seconds=self.duration) - now).total_seconds())
                bucket.save(update_fields=["window_started_at", "attempts", "updated_at"])
                return False
            bucket.attempts += 1
            bucket.save(update_fields=["window_started_at", "attempts", "updated_at"])
            self._wait = None
        return True

    def wait(self):
        return self._wait


def _serialize_user(u):
    return {
        "id":       u.id,
        "username": u.username,
        "email":    "",
        "mobile":   "",
        "role":     u.role,
        "credit":   u.credit,
        "status":   u.status,
        "parent":   u.parent.username if u.parent else None,
    }


def _serialize_campaign(c):
    return {
        "id":         c.id,
        "message":    c.message,
        "total":      c.total,
        "success":    c.success,
        "failed":     c.failed,
        "nonwa":      c.nonwa,
        "rejected":   c.rejected,
        "media":      c.media,
        "results":    c.results,
        "status":     c.status,
        "created_at": c.created_at.isoformat(),
        "numbers": [
            r.get("number") or r.get("phone") or r.get("mobile")
            for r in c.results
            if isinstance(r, dict)
        ],
    }


def _clean_results(raw):
    """
    Normalize Node.js result dicts into a consistent shape.
    Handles all number key variants sent by the Node server.
    """
    out = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        out.append({
            "number": (
                r.get("number") or r.get("phone") or
                r.get("mobile") or r.get("to") or ""
            ),
            "status": r.get("status", "unknown"),
            "files": [
                {"name": f.get("name", ""), "type": f.get("type", "")}
                for f in r.get("files", [])
                if isinstance(f, dict)
            ],
        })
    return out


def _validated_campaign_results(raw):
    """Validate and reduce caller or callback results to safe report metadata."""
    if not isinstance(raw, list) or len(raw) > 10000 or any(not isinstance(row, dict) for row in raw):
        return None, "Invalid campaign results."
    for row in raw:
        number = row.get("number", row.get("phone", row.get("mobile", row.get("to", ""))))
        status = row.get("status", "unknown")
        files = row.get("files", [])
        if (isinstance(number, bool) or not isinstance(number, (str, int)) or len(str(number)) > 64 or
                not isinstance(status, str) or len(status) > 40 or
                not isinstance(files, list) or len(files) > 20):
            return None, "Invalid campaign result fields."
        for file_item in files:
            if (not isinstance(file_item, dict) or
                    not isinstance(file_item.get("name", ""), str) or len(file_item.get("name", "")) > 255 or
                    not isinstance(file_item.get("type", ""), str) or len(file_item.get("type", "")) > 128):
                return None, "Invalid campaign media metadata."
    return _clean_results(raw), ""


def _normalize_campaign_number(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    digits = re.sub(r"\D", "", str(value))
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    return digits if 8 <= len(digits) <= 15 else None


def _extract_media(results):
    """Pull flat media list from cleaned results."""
    media = []
    for r in results:
        for f in r.get("files", []):
            if isinstance(f, dict) and f.get("name"):
                media.append({"name": f["name"], "type": f.get("type", "")})
    return media


def _tally(results):
    """Count sent / failed / nonwa in one pass."""
    sent = failed = nonwa = 0
    for r in results:
        s = r.get("status")
        if s == "sent":   sent   += 1
        elif s == "failed": failed += 1
        elif s == "nonwa":  nonwa  += 1
    return sent, failed, nonwa


def _credit_log(user, service, credit, credit_type, old_credit, notes, results=None):
    CreditLog.objects.create(
        user       = user,
        service    = service,
        credit     = credit,
        type       = credit_type,
        old_credit = old_credit,
        new_credit = user.credit,
        notes      = notes,
        results    = results or [],
    )


# ══════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════

@api_view(["POST"])
@throttle_classes([PanelLoginRateThrottle])
def login(request):
    try:
        username = str(
            request.data.get("username", "")
        ).strip().lower()

        password = str(
            request.data.get("password", "")
        ).strip()

        if not username or not password:
            return Response({
                "status": "failed",
                "message": "Missing credentials"
            })

        user = User.objects.filter(
            username__iexact=username
        ).first()

        if user is None:
            return Response({
                "status": "failed",
                "message": "Invalid username or password ❌"
            })

        authenticated = check_password(password, user.password)
        if not authenticated and str(user.password).strip() == password:
            # Upgrade legacy plaintext credentials after successful login.
            user.password = make_password(password)
            user.save(update_fields=["password"])
            authenticated = True

        if not authenticated:
            return Response({
                "status": "failed",
                "message": "Invalid username or password ❌"
            })

        if user.status != "Active":
            return Response({
                "status": "failed",
                "message": "Account disabled ❌"
            })

        return Response({
            "status": "success",
            "user_id": user.id,
            "username": user.username,
            "role": user.role,
            "credit": user.credit,
            "panel_token": issue_panel_token(user),
            "panel_token_max_age": int(os.environ.get("PANEL_TOKEN_MAX_AGE", "86400")),
        })

    except Exception:
        return Response({
            "status": "error",
            "message": "Unable to complete login."
        })



@api_view(["POST"])
def setup_admin(request):
    setup_token = os.environ.get("ADMIN_SETUP_TOKEN", "").strip()
    initial_password = os.environ.get("ADMIN_SETUP_PASSWORD", "")
    if not setup_token or not initial_password:
        return Response(
            {"status": "failed", "message": "Admin bootstrap is not configured."},
            status=503,
        )

    scheme, _, supplied_token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not constant_time_compare(setup_token, supplied_token):
        return Response({"status": "failed", "message": "Unauthorized"}, status=403)

    username = os.environ.get("ADMIN_SETUP_USERNAME", "admin").strip().lower()
    if not username or User.objects.filter(username__iexact=username).exists():
        return Response(
            {"status": "failed", "message": "Admin already exists or username is invalid."},
            status=409,
        )

    user = User.objects.create(
        username=username,
        password=make_password(initial_password),
        role="admin",
        credit=999999,
        status="Active",
    )
    return Response({
        "status": "success",
        "message": "Admin created successfully",
        "username": user.username,
        "role": user.role,
    })
    

# ══════════════════════════════════════════════════════════════════
# USER — CRUD
# ══════════════════════════════════════════════════════════════════

@api_view(["POST"])
def create_user(request):
    """
    POST /api/create-user/
    Body: { username, password, role, parent? }
    """
    actor, auth_error = _require_actor(request)
    if auth_error:
        return auth_error
    try:
        if actor.role not in ("admin", "reseller"):
            return Response({"status": "failed", "message": "Permission denied."}, status=403)
        username = str(request.data.get("username", "")).strip().lower()
        password = str(request.data.get("password", "")).strip()
        role     = str(request.data.get("role", "user")).lower()

        if not username or not password:
            return Response({"status": "failed", "message": "Missing fields"})

        if len(username) < 3:
            return Response({"status": "failed", "message": "Username too short"})
        if role not in {"admin", "reseller", "user"}:
            return Response({"status": "failed", "message": "Invalid role."}, status=400)
        if actor.role == "reseller" and role != "user":
            return Response({"status": "failed", "message": "Resellers can create user accounts only."}, status=403)

        if User.objects.filter(username__iexact=username).exists():
            return Response({"status": "failed", "message": "Username already exists"})

        # Reseller-created accounts are always children of that reseller; the
        # browser's parent field is never used to establish ownership.
        parent = actor if actor.role == "reseller" else None
        parent_username = request.data.get("parent")
        if actor.role == "admin" and parent_username:
            parent = User.objects.filter(username__iexact=str(parent_username).strip()).first()
            if not parent:
                return Response({"status": "failed", "message": "Parent user not found"}, status=404)
            rank = {"admin": 0, "reseller": 1, "user": 2}
            if rank[parent.role] >= rank[role]:
                return Response({"status": "failed", "message": "Parent must have a higher role."}, status=400)

        user = User.objects.create(
            username = username,
            password = make_password(password),
            role     = role,
            parent   = parent,
            credit   = 0,
            status   = "Active",
        )

        return Response({"status": "success", "user_id": user.id})

    except Exception:
        return Response({"status": "error", "message": "Unable to create user."}, status=500)


@api_view(["GET"])
def get_user(request):
    """
    GET /api/get-user/?user_id=X
    Returns single user basic info (used for credit refresh in frontend).
    """
    actor, auth_error = _require_actor(request)
    if auth_error:
        return auth_error
    user, err = _target_user(actor, request.GET.get("user_id"))
    if err:
        return err
    return Response({
        "id":       user.id,
        "username": user.username,
        "credit":   user.credit,
        "role":     user.role,
    })


@api_view(["GET"])
def get_users(request):
    """
    GET /api/get-users/?user_id=X
    Admin → all users
    Reseller → own children only
    User → own record only
    """
    try:
        user, auth_error = _require_actor(request)
        if auth_error:
            return auth_error

        if user.role == "admin":
            qs = User.objects.select_related("parent").all()
        elif user.role == "reseller":
            qs = User.objects.select_related("parent").filter(parent=user)
        else:
            qs = User.objects.filter(id=user.id)

        return Response([_serialize_user(u) for u in qs])

    except Exception:
        return Response({"status": "error", "message": "Unable to list users."}, status=500)


@api_view(["POST"])
def update_user(request):
    """
    POST /api/update-user/
    Body: { user_id, username?, password?, role?, status?, credit? }

    Credit logic:
      - diff > 0 (adding credit to child) → deduct from parent (if parent is not admin)
      - diff < 0 (removing credit from child) → return to parent
    """
    try:
        actor, auth_error = _require_actor(request)
        if auth_error:
            return auth_error
        user, err = _target_user(actor, request.data.get("user_id"))
        if err:
            return err

        self_update = actor.pk == user.pk
        if actor.role == "user" and not self_update:
            return Response({"status": "failed", "message": "Permission denied."}, status=403)
        protected_fields = {"role", "parent", "credit"}
        if self_update and protected_fields.intersection(request.data.keys()):
            return Response({"status": "failed", "message": "Role, parent, and credit cannot be changed through self-service."}, status=403)
        if actor.role == "reseller" and user.role != "user" and not self_update:
            return Response({"status": "failed", "message": "Resellers can manage user accounts only."}, status=403)

        allowed_status = {"Active", "Deactive"}
        if "status" in request.data and request.data["status"] not in allowed_status:
            return Response({"status": "failed", "message": "Invalid status."}, status=400)
        if self_update and "status" in request.data:
            return Response({"status": "failed", "message": "Users cannot change their own account status."}, status=403)
        if "role" in request.data:
            requested_role = str(request.data["role"]).lower()
            if requested_role not in {"admin", "reseller", "user"}:
                return Response({"status": "failed", "message": "Invalid role."}, status=400)
            if actor.role != "admin" or self_update:
                return Response({"status": "failed", "message": "Only admins may change another user's role."}, status=403)
            if user.parent_id and {"admin": 0, "reseller": 1, "user": 2}[user.parent.role] >= {"admin": 0, "reseller": 1, "user": 2}[requested_role]:
                return Response({"status": "failed", "message": "Role would violate the parent hierarchy."}, status=400)
            if any({"admin": 0, "reseller": 1, "user": 2}[requested_role] >= {"admin": 0, "reseller": 1, "user": 2}[child.role] for child in user.children.all()):
                return Response({"status": "failed", "message": "Role would violate a child account's hierarchy."}, status=400)
        if "parent" in request.data:
            if actor.role != "admin" or self_update:
                return Response({"status": "failed", "message": "Only admins may change parent ownership."}, status=403)
            parent_name = request.data.get("parent")
            new_parent = User.objects.filter(username__iexact=str(parent_name).strip()).first() if parent_name else None
            if parent_name and not new_parent:
                return Response({"status": "failed", "message": "Parent user not found."}, status=404)
            role_for_target = str(request.data.get("role", user.role)).lower()
            if new_parent and {"admin": 0, "reseller": 1, "user": 2}[new_parent.role] >= {"admin": 0, "reseller": 1, "user": 2}[role_for_target]:
                return Response({"status": "failed", "message": "Parent must have a higher role."}, status=400)
            user.parent = new_parent
        # Lock both the account and its parent so credit transfers cannot race
        # with another transfer or campaign debit.
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=user.pk)
            old_credit = int(user.credit or 0)
            new_credit = old_credit
            if "credit" in request.data:
                raw_credit = request.data["credit"]
                if isinstance(raw_credit, bool):
                    return Response({"status": "failed", "message": "Credit must be a non-negative integer."}, status=400)
                if isinstance(raw_credit, int):
                    new_credit = raw_credit
                elif isinstance(raw_credit, str) and re.fullmatch(r"\d+", raw_credit.strip()):
                    new_credit = int(raw_credit.strip())
                else:
                    return Response({"status": "failed", "message": "Credit must be a non-negative integer."}, status=400)
            if new_credit < 0 or new_credit > 2147483647:
                return Response({"status": "failed", "message": "Credit must be a non-negative integer in the supported range."}, status=400)
            diff = new_credit - old_credit
            if diff and actor.role != "admin" and not (actor.role == "reseller" and user.parent_id == actor.pk):
                return Response({"status": "failed", "message": "Only the account owner or an admin may change this balance."}, status=403)
            if user.parent and diff != 0:
                parent = User.objects.select_for_update().get(id=user.parent_id)

                if diff > 0:
                    # Adding credit to child — deduct from parent
                    if parent.role != "admin":
                        if parent.credit < diff:
                            return Response({
                                "status":  "failed",
                                "message": "Parent has insufficient balance ❌",
                            })
                        parent.credit -= diff
                    parent.save()

                else:
                    # Removing credit from child return to parent
                    parent.credit += abs(diff)
                    parent.save()

            user.username = str(request.data.get("username", user.username)).strip().lower()
            if request.data.get("password"):
                user.password = make_password(str(request.data.get("password")).strip())
                user.token_version += 1
            user.role = str(request.data.get("role", user.role)).lower()
            user.status = request.data.get("status", user.status)
            if "parent" in request.data:
                user.parent = new_parent
            user.credit = new_credit
            user.save()
            if diff != 0:
                _credit_log(
                    user=user, service="WHATSAPP", credit=abs(diff),
                    credit_type="Credit" if diff > 0 else "Debit",
                    old_credit=old_credit,
                    notes="Credit Added by Parent" if diff > 0 else "Credit Removed",
                )

        return Response({"status": "success"})

    except Exception:
        return Response({"status": "failed", "message": "Unable to update user."}, status=500)


@api_view(["POST"])
def delete_user(request):
    """
    POST /api/delete-user/
    Body: { user_id }
    """
    try:
        actor, auth_error = _require_actor(request)
        if auth_error:
            return auth_error
        user, err = _target_user(actor, request.data.get("user_id"), allow_self=False)
        if err:
            return err
        if actor.role == "user" or (actor.role == "reseller" and user.role != "user"):
            return Response({"status": "failed", "message": "Permission denied."}, status=403)
        if user.children.exists():
            return Response({"status": "failed", "message": "Reassign or remove child accounts before deleting this account."}, status=409)
        user.delete()
        return Response({"status": "success"})

    except Exception as e:
        print("DELETE ERROR:", e)
        return Response({"status": "error"})


@api_view(["POST"])
def toggle_user_status(request):
    """
    POST /api/toggle-status/
    Body: { user_id }
    Flips Active ↔ Deactive.
    """
    try:
        actor, auth_error = _require_actor(request)
        if auth_error:
            return auth_error
        user, err = _target_user(actor, request.data.get("user_id"), allow_self=False)
        if err:
            return err
        if actor.role == "user" or (actor.role == "reseller" and user.role != "user"):
            return Response({"status": "failed", "message": "Permission denied."}, status=403)
        user.status = "Deactive" if user.status == "Active" else "Active"
        user.save(update_fields=["status"])
        return Response({"status": "success", "new_status": user.status})

    except Exception as e:
        print("STATUS ERROR:", e)
        return Response({"status": "error"})


@api_view(["POST"])
def reset_password(request):
    """
    POST /api/reset-password/
    Body: { user_id, password }
    """
    try:
        actor, auth_error = _require_actor(request)
        if auth_error:
            return auth_error
        user, err = _target_user(actor, request.data.get("user_id"))
        if err:
            return err
        if actor.role == "reseller" and user.role != "user" and user.pk != actor.pk:
            return Response({"status": "failed", "message": "Resellers can reset user accounts only."}, status=403)

        new_password = str(request.data.get("password", "")).strip()
        if not new_password:
            return Response({"status": "failed", "message": "Password cannot be empty"})
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=user.pk)
            user.password = make_password(new_password)
            user.token_version += 1
            user.save(update_fields=["password", "token_version"])
        return Response({"status": "success"})

    except Exception as e:
        print("RESET ERROR:", e)
        return Response({"status": "error"})


# ══════════════════════════════════════════════════════════════════
# CREDIT LOGS
# ══════════════════════════════════════════════════════════════════

@api_view(["GET"])
def get_credit_logs(request):
    """
    GET /api/get-credit-logs/?user_id=X
    Returns all credit transactions for a user, newest first.
    """
    actor, auth_error = _require_actor(request)
    if auth_error:
        return auth_error
    target, err = _target_user(actor, request.GET.get("user_id"))
    if err:
        return err

    logs = (
        CreditLog.objects
        .select_related("user")
        .filter(user=target)
        .order_by("-created_at")
    )

    return Response([
        {
            "username":  log.user.username,
            "service":   log.service,
            "credit":    log.credit,
            "type":      log.type,
            "transTime": log.created_at.strftime("%d-%m-%Y %H:%M"),
            "oldCredit": log.old_credit,
            "newCredit": log.new_credit,
            "sysnotes":  "",
            "notes":     log.notes,
            "results":   log.results,
            "numbers": [
                r.get("number") for r in log.results
                if isinstance(r, dict)
            ],
        }
        for log in logs
    ])


# ══════════════════════════════════════════════════════════════════
# CAMPAIGN
# ══════════════════════════════════════════════════════════════════

@api_view(["POST"])
def send_whatsapp(request):
    """
    POST /api/send-whatsapp/
    Authenticated panel endpoint for creating a pending campaign reservation.
    Only the trusted Node callback may finalize a reservation or release credit.
    """
    actor, auth_error = _require_actor(request)
    if auth_error:
        return auth_error
    if not getattr(settings, "CAMPAIGN_DISPATCH_ENABLED", False):
        return Response({"status": "failed", "message": "Campaign dispatch is disabled until the sender is verified."}, status=503)
    try:
        d = request.data
        if not isinstance(d, dict):
            return Response({"status": "failed", "message": "Request body must be a JSON object."}, status=400)

        results, validation_error = _validated_campaign_results(d.get("results", []))
        if validation_error:
            return Response({"status": "failed", "message": validation_error}, status=400)
        message = d.get("message", "")
        raw_total = d.get("total", 0)
        if isinstance(raw_total, bool) or not str(raw_total).isdigit():
            return Response({"status": "failed", "message": "Total must be a positive integer."}, status=400)
        total = int(raw_total)
        user_id = d.get("user_id")

        # Campaigns and their credit charge always belong to the authenticated
        # sender. A caller-provided user_id is only accepted as a consistency
        # check, never as identity.
        if user_id not in (None, "") and str(user_id) != str(actor.pk):
            return Response({"status": "failed", "message": "Campaign owner must match the authenticated account."}, status=403)
        user = actor
        if total <= 0 or total > 10000:
            return Response({"status": "failed", "message": "Total must be between 1 and 10000."}, status=400)
        if total != len(results):
            return Response({"status": "failed", "message": "Total must match the submitted results count."}, status=400)
        reserved_numbers = [_normalize_campaign_number(row["number"]) for row in results]
        if any(number is None for number in reserved_numbers) or len(set(reserved_numbers)) != len(reserved_numbers):
            return Response({"status": "failed", "message": "Campaign recipients must be valid and unique."}, status=400)
        # The browser creates a reservation, never a report of delivery.
        results = [{**row, "status": "pending"} for row in results]
        if not isinstance(message, str) or len(message) > 10000:
            return Response({"status": "failed", "message": "Invalid campaign message."}, status=400)
        if d.get("status", "pending") != "pending" or d.get("campaign_id") not in (None, ""):
            return Response({"status": "failed", "message": "Campaign finalization is restricted to the trusted callback."}, status=403)

        with transaction.atomic():
            # Check ownership and balance before any campaign/credit write.
            locked_user = User.objects.select_for_update().get(id=actor.id)
            old_credit = locked_user.credit
            if locked_user.role != "admin":
                if locked_user.credit < total:
                    return Response({"status": "failed", "message": "Insufficient Balance ❌"})
                locked_user.credit -= total
                locked_user.save(update_fields=["credit"])
            user = locked_user
            campaign = Campaign.objects.create(
                user=user, message=message, total=total, media=_extract_media(results),
                results=results, status="pending", credit_reserved=(user.role != "admin"),
            )
            if user.role != "admin":
                _credit_log(
                    user=user, service="WHATSAPP", credit=total,
                    credit_type="Debit", old_credit=old_credit,
                    notes="Campaign queued",
                    results=results,
                )

        return Response({
            "status":           "saved",
            "remaining_credit": user.credit,
            "campaign_id":      campaign.id,
        })

    except Exception:
        return Response({"status": "error", "message": "Unable to save campaign."}, status=500)


@api_view(["POST"])
def campaign_callback(request):
    """Finalize a reserved campaign from the trusted Node service only."""
    callback_secret = os.environ.get("CAMPAIGN_CALLBACK_SECRET", "")
    if len(callback_secret) < 32:
        return Response({"status": "error", "message": "Campaign callback is not configured."}, status=503)
    timestamp = request.headers.get("X-Campaign-Timestamp", "")
    supplied_signature = request.headers.get("X-Campaign-Signature", "")
    if not re.fullmatch(r"\d{10}", timestamp) or not re.fullmatch(r"v1=[0-9a-f]{64}", supplied_signature):
        return Response({"status": "failed", "message": "Callback signature required."}, status=401)
    timestamp_value = int(timestamp)
    now = int(timezone.now().timestamp())
    if abs(now - timestamp_value) > 300:
        return Response({"status": "failed", "message": "Callback signature expired."}, status=401)
    signed_content = timestamp.encode("ascii") + b"." + request.body
    expected_signature = "v1=" + hmac.new(
        callback_secret.encode("utf-8"), signed_content, hashlib.sha256,
    ).hexdigest()
    if not constant_time_compare(expected_signature, supplied_signature):
        return Response({"status": "failed", "message": "Unauthorized callback."}, status=401)
    if not isinstance(request.data, dict):
        return Response({"status": "failed", "message": "Request body must be a JSON object."}, status=400)

    event_id = request.data.get("event_id")
    if not isinstance(event_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", event_id):
        return Response({"status": "failed", "message": "Invalid event_id."}, status=400)
    campaign_id = request.data.get("campaign_id")
    if isinstance(campaign_id, bool):
        return Response({"status": "failed", "message": "Invalid campaign_id."}, status=400)
    try:
        campaign_id = int(campaign_id)
    except (TypeError, ValueError):
        return Response({"status": "failed", "message": "Invalid campaign_id."}, status=400)
    if campaign_id <= 0 or campaign_id > 9223372036854775807:
        return Response({"status": "failed", "message": "Invalid campaign_id."}, status=400)

    final_status = request.data.get("status")
    reason = request.data.get("reason", "")
    allowed_reasons = {"", "blocked", "no_device", "dispatch_failed", "timeout", "unknown"}
    if (not isinstance(final_status, str) or final_status not in {"completed", "failed", "unknown"} or
            not isinstance(reason, str) or reason not in allowed_reasons):
        return Response({"status": "failed", "message": "Invalid campaign outcome."}, status=400)
    if final_status == "failed" and reason not in {"blocked", "no_device", "dispatch_failed"}:
        return Response({"status": "failed", "message": "A definitive failure reason is required."}, status=400)
    if final_status == "completed" and reason:
        return Response({"status": "failed", "message": "Completed outcomes must not include a failure reason."}, status=400)
    if final_status == "unknown" and reason not in {"timeout", "unknown"}:
        return Response({"status": "failed", "message": "Unknown outcomes require a timeout or unknown reason."}, status=400)

    results, validation_error = _validated_campaign_results(request.data.get("results", []))
    if validation_error:
        return Response({"status": "failed", "message": validation_error}, status=400)
    if any(result["status"] not in RECIPIENT_FINAL_STATUSES for result in results):
        return Response({"status": "failed", "message": "Invalid recipient result status."}, status=400)
    result_numbers = [_normalize_campaign_number(result["number"]) for result in results]
    if any(number is None for number in result_numbers) or len(set(result_numbers)) != len(result_numbers):
        return Response({"status": "failed", "message": "Callback recipients must be valid and unique."}, status=400)
    safe_payload = {
        "campaign_id": campaign_id,
        "status": final_status,
        "reason": reason,
        "results": results,
    }
    payload_hash = hashlib.sha256(
        json.dumps(safe_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    event_metadata = {"reason": reason, "result_count": len(results)}

    try:
        with transaction.atomic():
            try:
                campaign = Campaign.objects.select_for_update().get(pk=campaign_id)
            except Campaign.DoesNotExist:
                return Response({"status": "failed", "message": "Campaign not found."}, status=404)

            prior_event = CampaignCallbackEvent.objects.filter(event_id=event_id).first()
            if prior_event:
                if prior_event.campaign_id == campaign.id and prior_event.payload_hash == payload_hash:
                    return Response({"status": "duplicate", "campaign_id": campaign.id})
                return Response({"status": "failed", "message": "event_id was already used for a different callback."}, status=409)

            if campaign.status in {"completed", "failed"}:
                return Response({"status": "failed", "message": "Campaign already has a final outcome."}, status=409)
            if campaign.status not in {"pending", "unknown"}:
                return Response({"status": "failed", "message": "Campaign is not awaiting a callback."}, status=409)
            reserved_numbers = [
                _normalize_campaign_number(result.get("number"))
                for result in campaign.results
                if isinstance(result, dict)
            ]
            if (len(reserved_numbers) != campaign.total or any(number is None for number in reserved_numbers) or
                    len(set(reserved_numbers)) != len(reserved_numbers)):
                return Response({"status": "failed", "message": "Campaign reservation recipient data requires reconciliation."}, status=409)
            reserved_set = set(reserved_numbers)
            if not set(result_numbers).issubset(reserved_set):
                return Response({"status": "failed", "message": "Callback contains a recipient outside the reservation."}, status=400)
            if final_status == "completed" and (len(results) != campaign.total or set(result_numbers) != reserved_set):
                return Response({"status": "failed", "message": "Completed callbacks must include each reserved recipient exactly once."}, status=400)
            if final_status == "failed" and results:
                return Response({"status": "failed", "message": "Definitive no-dispatch failures must not include recipient outcomes."}, status=400)

            CampaignCallbackEvent.objects.create(
                campaign=campaign,
                event_id=event_id,
                payload_hash=payload_hash,
                status=final_status,
                metadata=event_metadata,
            )
            if final_status == "unknown":
                # Keep pending so existing reports continue polling. Credits
                # remain reserved until a later definitive callback or review.
                return Response({"status": "unknown", "campaign_id": campaign.id})

            if final_status == "completed":
                sent, failed, nonwa = _tally(results)
                campaign.success = sent
                campaign.failed = failed
                campaign.nonwa = nonwa
                campaign.media = _extract_media(results)
                campaign.results = results
                campaign.status = "completed"
                campaign.credit_reserved = False
                campaign.save(update_fields=["success", "failed", "nonwa", "media", "results", "status", "credit_reserved"])
                return Response({"status": "ok", "campaign_id": campaign.id})

            if campaign.credit_reserved:
                locked_user = User.objects.select_for_update().get(pk=campaign.user_id)
                old_credit = locked_user.credit
                locked_user.credit += campaign.total
                locked_user.save(update_fields=["credit"])
                _credit_log(
                    user=locked_user,
                    service="WHATSAPP",
                    credit=campaign.total,
                    credit_type="Credit",
                    old_credit=old_credit,
                    notes=f"Campaign reservation released ({reason}).",
                    results=results,
                )
            campaign.status = "failed"
            campaign.failed = campaign.total
            campaign.results = results
            campaign.credit_reserved = False
            campaign.save(update_fields=["status", "failed", "results", "credit_reserved"])
            return Response({"status": "ok", "campaign_id": campaign.id})
    except IntegrityError:
        # Another concurrent retry may have inserted this unique event ID.
        prior_event = CampaignCallbackEvent.objects.filter(event_id=event_id).first()
        if prior_event and prior_event.campaign_id == campaign_id and prior_event.payload_hash == payload_hash:
            return Response({"status": "duplicate", "campaign_id": campaign_id})
        return Response({"status": "failed", "message": "Conflicting callback event."}, status=409)


@api_view(["GET"])
def get_campaigns(request):
    """
    GET /api/get-campaigns/?user_id=X
    Admin   → all campaigns
    Reseller → own + children's campaigns
    User    → own campaigns only
    All ordered newest-first.
    """
    try:
        user, auth_error = _require_actor(request)
        if auth_error:
            return auth_error
        # Supplied user_id is ignored for scope and rejected if it conflicts;
        # the signed token is the sole source of the acting identity.
        requested_id = request.GET.get("user_id")
        if requested_id and str(requested_id) != str(user.pk):
            return Response({"status": "failed", "message": "User ID does not match the authenticated account."}, status=403)

        if user.role == "admin":
            qs = Campaign.objects.select_related("user").order_by("-created_at")

        elif user.role == "reseller":
            child_ids = list(
                user.children.values_list("id", flat=True)
            )
            qs = Campaign.objects.select_related("user").filter(
                user_id__in=[user.id, *child_ids]
            ).order_by("-created_at")

        else:
            qs = Campaign.objects.filter(user=user).order_by("-created_at")

        return Response([_serialize_campaign(c) for c in qs])

    except Exception:
        return Response({"status": "error", "message": "Unable to list campaigns."}, status=500)
