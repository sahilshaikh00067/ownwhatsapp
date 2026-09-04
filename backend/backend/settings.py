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

DATABASES = {
"default": dj_database_url.config(
default=os.environ.get("DATABASE_URL"),
conn_max_age=600,
ssl_require=False,
)
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

# =========================================================

# STATIC FILES

# =========================================================

STATIC_URL = "/static/"

STATIC_ROOT = BASE_DIR / "staticfiles"

# =========================================================

# DEFAULT PRIMARY KEY

# =========================================================

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
