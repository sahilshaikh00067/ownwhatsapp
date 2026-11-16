"""
Django settings for backend project.
"""

import os
from pathlib import Path

import dj_database_url

# =========================================================

# BASE

# =========================================================

BASE_DIR = Path(__file__).resolve().parent.parent
# =========================================================

# SECURITY

# =========================================================

SECRET_KEY = os.environ.get(
"DJANGO_SECRET_KEY",
"django-insecure-change-this-in-production"
)

DEBUG = os.environ.get(
"DEBUG",
"False"
).lower() == "true"

# =========================================================

# HOSTS

# =========================================================

ALLOWED_HOSTS = [
"ownwhatsapp-backend-django.onrender.com",
"localhost",
"127.0.0.1",
]

# =========================================================

# INSTALLED APPS

# =========================================================

INSTALLED_APPS = [
"django.contrib.admin",
"django.contrib.auth",
"django.contrib.contenttypes",
"django.contrib.sessions",
"django.contrib.messages",
"django.contrib.staticfiles",
"rest_framework",
"corsheaders",
"api",

]

# =========================================================

# MIDDLEWARE

# =========================================================

MIDDLEWARE = [
"corsheaders.middleware.CorsMiddleware",
"django.middleware.security.SecurityMiddleware",
"django.contrib.sessions.middleware.SessionMiddleware",
"django.middleware.common.CommonMiddleware",
"django.middleware.csrf.CsrfViewMiddleware",
"django.contrib.auth.middleware.AuthenticationMiddleware",
"django.contrib.messages.middleware.MessageMiddleware",
"django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# =========================================================

# CORS

# =========================================================

CORS_ALLOWED_ORIGINS = [
"https://ownwhatsapp.vercel.app",
]

CORS_ALLOWED_ORIGIN_REGEXES = [
r"^http://localhost:\d+$",
r"^http://127.0.0.1:\d+$",
]

# =========================================================

# CSRF

# =========================================================

CSRF_TRUSTED_ORIGINS = [
"https://ownwhatsapp.vercel.app",
"https://ownwhatsapp-backend-django.onrender.com",
]

# =========================================================

# URL CONFIGURATION

# =========================================================

ROOT_URLCONF = "backend.urls"

# =========================================================

# TEMPLATES

# =========================================================

TEMPLATES = [
{
"BACKEND": "django.template.backends.django.DjangoTemplates",
"DIRS": [],
"APP_DIRS": True,
"OPTIONS": {
"context_processors": [
"django.template.context_processors.request",
"django.contrib.auth.context_processors.auth",
"django.contrib.messages.context_processors.messages",
],
},
},
]

# =========================================================

# WSGI

# =========================================================

WSGI_APPLICATION = "backend.wsgi.application"

# =========================================================

# DATABASE

# =========================================================


# =========================================================
# DATABASE - NEON POSTGRESQL
# =========================================================

DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.parse(
            DATABASE_URL,
            conn_max_age=600,
            ssl_require=True,
        )
    }
else:
    # Local development only
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }



# =========================================================

# PASSWORD VALIDATION

# =========================================================

AUTH_PASSWORD_VALIDATORS = [
{
"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
},
{
"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
},
{
"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
},
{
"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
},
]

# =========================================================

# LANGUAGE / TIME

# =========================================================

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True

# Login throttling is scoped only to the login endpoint. The custom throttle
# stores keyed IP digests in the application database, so limits are shared by
# all web workers without persisting raw IP addresses.
_trusted_proxy_count = os.environ.get("PANEL_TRUSTED_PROXY_COUNT", "").strip()
if _trusted_proxy_count:
    try:
        _trusted_proxy_count = int(_trusted_proxy_count)
    except ValueError as exc:
        raise ValueError("PANEL_TRUSTED_PROXY_COUNT must be a non-negative integer") from exc
    if _trusted_proxy_count < 0:
        raise ValueError("PANEL_TRUSTED_PROXY_COUNT must be a non-negative integer")
else:
    _trusted_proxy_count = None

REST_FRAMEWORK = {
    "DEFAULT_THROTTLE_RATES": {
        "login": os.environ.get("PANEL_LOGIN_RATE", "20/min"),
    },
    # If unset, DRF uses REMOTE_ADDR. Set this only after verifying how many
    # trusted proxies sanitize/append X-Forwarded-For in the production chain.
    "NUM_PROXIES": _trusted_proxy_count,
}

# Fail closed until a verified Node bulk sender and callback are deployed.
CAMPAIGN_DISPATCH_ENABLED = False

# =========================================================

# STATIC FILES

# =========================================================

STATIC_URL = "/static/"

STATIC_ROOT = BASE_DIR / "staticfiles"

# =========================================================

# DEFAULT PRIMARY KEY

# =========================================================

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
