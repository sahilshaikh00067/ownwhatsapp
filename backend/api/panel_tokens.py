"""Helpers for versioned Django-signed panel sessions."""

from django.core import signing

from .models import User


PANEL_TOKEN_SALT = "provider-panel-session"


def issue_panel_token(user):
    return signing.dumps(
        {"user_id": user.pk, "token_version": user.token_version},
        salt=PANEL_TOKEN_SALT,
    )


def load_panel_user(token, max_age):
    payload = signing.loads(token, salt=PANEL_TOKEN_SALT, max_age=max_age)
    if not isinstance(payload, dict):
        raise signing.BadSignature("Invalid panel token payload")
    user = User.objects.get(pk=payload.get("user_id"), status="Active")
    version = payload.get("token_version")
    if isinstance(version, bool) or not isinstance(version, int) or version != user.token_version:
        raise signing.BadSignature("Panel token has been revoked")
    return user
