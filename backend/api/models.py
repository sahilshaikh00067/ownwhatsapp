from django.db import models


# ============================================================
# USER
# ============================================================


class User(models.Model):
    ROLE_CHOICES = (
        ("admin", "Admin"),
        ("reseller", "Reseller"),
        ("user", "User"),
    )

    username = models.CharField(max_length=100, unique=True)
    password = models.CharField(max_length=255)
    role = models.CharField(
        max_length=20,
        choices=ROLE_CHOICES,
        default="user"
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="children"
    )
    credit = models.IntegerField(default=0)
    status = models.CharField(max_length=10, default="Active")
    token_version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.credit < 0:
            self.credit = 0
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.username} ({self.role})"




def save(self, *args, **kwargs):
    if self.credit < 0:
        self.credit = 0

    super().save(*args, **kwargs)

    def __str__(self):

        return f"{self.username} ({self.role})"


# =========================================================
# CREDIT LOG
# =========================================================

class CreditLog(models.Model):

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE
    )

    service = models.CharField(
        max_length=50
    )

    credit = models.IntegerField()

    type = models.CharField(
        max_length=20
    )

    old_credit = models.IntegerField()

    new_credit = models.IntegerField()

    notes = models.TextField(
        blank=True
    )

    results = models.JSONField(
        default=list
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )


# ============================================================
# CAMPAIGN
# ============================================================

class Campaign(models.Model):

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE
    )

    # Main campaign message
    message = models.TextField()

    # Total numbers
    total = models.IntegerField()

    # Campaign results
    success = models.IntegerField(
        default=0
    )

    failed = models.IntegerField(
        default=0
    )

    nonwa = models.IntegerField(
        default=0
    )

    rejected = models.IntegerField(
        default=0
    )

    # Uploaded media details
    media = models.JSONField(
        default=list
    )

    # Individual number results
    results = models.JSONField(
        default=list
    )

    # ========================================================
    # NEW: VISIT NOW BUTTON/LINK
    # ========================================================

    visit_url = models.URLField(
        max_length=500,
        blank=True,
        null=True
    )

    # ========================================================
    # NEW: CALL NOW NUMBER
    # ========================================================

    call_number = models.CharField(
        max_length=30,
        blank=True,
        null=True
    )

    # pending / processing / completed / failed
    status = models.CharField(
        max_length=20,
        default="completed"
    )

    # Set while a non-admin campaign's credits are reserved for dispatch.
    credit_reserved = models.BooleanField(default=False)

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    def __str__(self):

        return (
            f"Campaign #{self.id} - "
            f"{self.user.username} - "
            f"{self.status}"
        )


class CampaignCallbackEvent(models.Model):
    """Idempotency receipt for a trusted Node campaign outcome callback."""

    STATUS_CHOICES = (
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("unknown", "Unknown"),
    )

    campaign = models.ForeignKey(
        Campaign,
        on_delete=models.CASCADE,
        related_name="callback_events",
    )
    event_id = models.CharField(max_length=128, unique=True)
    payload_hash = models.CharField(max_length=64)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["campaign", "created_at"])]

    def __str__(self):
        return f"Campaign {self.campaign_id}: {self.status} ({self.event_id})"


class PanelLoginThrottle(models.Model):
    """Database-backed login throttle bucket keyed by a keyed IP digest."""

    key_digest = models.CharField(max_length=64, primary_key=True)
    window_started_at = models.DateTimeField()
    attempts = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)


class ProviderSyncState(models.Model):
    """Most recent provider sync result, without storing provider credentials."""

    name = models.CharField(max_length=80, unique=True)
    status = models.CharField(max_length=20, default="pending")
    last_synced_at = models.DateTimeField(null=True, blank=True)
    safe_message = models.CharField(max_length=240, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name}: {self.status}"


class ProviderTemplateCache(models.Model):
    """Latest safe copy of provider template metadata for panel browsing."""

    external_id = models.CharField(max_length=160, unique=True)
    template_id = models.CharField(max_length=160, blank=True)
    name = models.CharField(max_length=255)
    language = models.CharField(max_length=32, blank=True)
    category_name = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=40, blank=True)
    content = models.JSONField(default=dict, blank=True)
    provider_created_at = models.CharField(max_length=64, blank=True)
    provider_updated_at = models.CharField(max_length=64, blank=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["name"]), models.Index(fields=["state"])]

    def __str__(self):
        return self.name


class ProviderWebhookEvent(models.Model):
    """Webhook receipt metadata; message contents and credentials are not stored."""

    event_id = models.CharField(max_length=160, blank=True, db_index=True)
    event_type = models.CharField(max_length=120, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.event_type or 'provider_event'} ({self.received_at:%Y-%m-%d %H:%M})"


class ProviderApiAudit(models.Model):
    """Minimal audit metadata for panel initiated provider API calls."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="provider_api_audits",
    )
    operation = models.CharField(max_length=64)
    method = models.CharField(max_length=10)
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    succeeded = models.BooleanField(default=False)
    safe_message = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["user", "-created_at"])]

    def __str__(self):
        return f"{self.operation} ({self.status_code or 'not sent'})"
