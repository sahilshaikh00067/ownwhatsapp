import hashlib
import hmac
import importlib
import json
import os
from unittest.mock import patch

from django.core import signing
from django.apps import apps as current_apps
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Campaign, CampaignCallbackEvent, CreditLog, User


CALLBACK_SECRET = "campaign-callback-test-secret-with-32-plus-chars"


@override_settings(SECRET_KEY="campaign-callback-tests-use-a-strong-secret", CAMPAIGN_DISPATCH_ENABLED=True)
class CampaignCallbackIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            username="campaign-user", password="hashed-value", role="user",
            credit=12, status="Active",
        )
        self.panel_token = signing.dumps({"user_id": self.user.pk, "token_version": self.user.token_version}, salt="provider-panel-session")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.panel_token}")
        self.callback_env = patch.dict(os.environ, {"CAMPAIGN_CALLBACK_SECRET": CALLBACK_SECRET})
        self.callback_env.start()
        self.addCleanup(self.callback_env.stop)

    def reserve(self, number="919999999999"):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.panel_token}")
        response = self.client.post("/api/send-whatsapp/", {
            "results": [{"number": number, "status": "pending", "files": []}],
            "message": "hello",
            "total": 1,
            "user_id": self.user.pk,
            "status": "pending",
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "saved")
        self.assertEqual(response.data["remaining_credit"], 11)
        return Campaign.objects.get(pk=response.data["campaign_id"])

    def test_campaign_reservation_fails_closed_when_dispatch_is_disabled(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.panel_token}")
        with self.settings(CAMPAIGN_DISPATCH_ENABLED=False):
            response = self.client.post("/api/send-whatsapp/", {
                "results": [{"number": "919999999999", "status": "pending", "files": []}],
                "message": "hello", "total": 1, "user_id": self.user.pk,
            }, format="json")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.user.__class__.objects.get(pk=self.user.pk).credit, 12)
        self.assertFalse(Campaign.objects.exists())

    def callback(self, campaign, event_id, status, *, reason="", results=None, secret=CALLBACK_SECRET, timestamp_offset=0):
        body = {
            "campaign_id": campaign.pk,
            "event_id": event_id,
            "status": status,
            "reason": reason,
            "results": results or [],
        }
        raw_body = json.dumps(body, separators=(",", ":")).encode("utf-8")
        timestamp = str(int(timezone.now().timestamp()) + timestamp_offset)
        signed_content = timestamp.encode("ascii") + b"." + raw_body
        signature = "v1=" + hmac.new(secret.encode("utf-8"), signed_content, hashlib.sha256).hexdigest()
        return self.client.post(
            "/api/campaigns/callback/", raw_body, content_type="application/json",
            HTTP_X_CAMPAIGN_TIMESTAMP=timestamp,
            HTTP_X_CAMPAIGN_SIGNATURE=signature,
        )

    def test_campaign_reservation_debits_once_and_records_reserved_credit(self):
        campaign = self.reserve()
        self.user.refresh_from_db()
        self.assertEqual(self.user.credit, 11)
        self.assertTrue(campaign.credit_reserved)
        self.assertEqual(campaign.status, "pending")
        debit = CreditLog.objects.get(user=self.user)
        self.assertEqual((debit.type, debit.old_credit, debit.new_credit), ("Debit", 12, 11))

    def test_migration_0017_marks_only_pending_non_admin_rows_as_reserved(self):
        admin = User.objects.create(
            username="migration-admin", password="x", role="admin", credit=0,
            status="Active",
        )
        pending_user = Campaign.objects.create(user=self.user, message="pending", total=1, status="pending")
        completed_user = Campaign.objects.create(user=self.user, message="completed", total=1, status="completed")
        pending_admin = Campaign.objects.create(user=admin, message="admin", total=1, status="pending")

        migration = importlib.import_module("api.migrations.0017_campaign_callback_receipts")
        migration.mark_existing_pending_reservations(current_apps, None)

        pending_user.refresh_from_db()
        completed_user.refresh_from_db()
        pending_admin.refresh_from_db()
        self.assertTrue(pending_user.credit_reserved)
        self.assertFalse(completed_user.credit_reserved)
        self.assertFalse(pending_admin.credit_reserved)

    def test_client_cannot_finalize_or_refund_using_panel_token(self):
        campaign = self.reserve()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.panel_token}")
        for status in ("completed", "failed"):
            response = self.client.post("/api/send-whatsapp/", {
                "campaign_id": campaign.pk,
                "total": 1,
                "results": [{"number": "919999999999", "status": "sent"}],
                "status": status,
                "user_id": self.user.pk,
            }, format="json")
            self.assertEqual(response.status_code, 403)
        self.user.refresh_from_db()
        campaign.refresh_from_db()
        self.assertEqual(self.user.credit, 11)
        self.assertTrue(campaign.credit_reserved)

    def test_callback_requires_configured_server_secret(self):
        campaign = self.reserve()
        with patch.dict(os.environ, {"CAMPAIGN_CALLBACK_SECRET": ""}):
            self.assertEqual(self.callback(campaign, "event-unconfigured", "completed").status_code, 503)
        response = self.callback(campaign, "event-forged", "completed", secret="wrong-callback-secret-value-32chars")
        self.assertEqual(response.status_code, 401)
        stale = self.callback(campaign, "event-stale", "completed", timestamp_offset=-301)
        self.assertEqual(stale.status_code, 401)
        self.assertEqual(campaign.callback_events.count(), 0)

    def test_completed_callback_updates_campaign_once_without_extra_credit_change(self):
        campaign = self.reserve()
        results = [
            {"number": "919999999999", "status": "sent", "provider_token": "must-not-persist",
             "files": [{"name": "photo.jpg", "type": "image/jpeg", "authorization": "secret"}]}
        ]
        response = self.callback(campaign, "job-1:completed", "completed", results=results)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ok")
        campaign.refresh_from_db()
        self.user.refresh_from_db()
        self.assertEqual(campaign.status, "completed")
        self.assertEqual(campaign.success, 1)
        self.assertFalse(campaign.credit_reserved)
        self.assertEqual(campaign.results, [{
            "number": "919999999999", "status": "sent",
            "files": [{"name": "photo.jpg", "type": "image/jpeg"}],
        }])
        self.assertEqual(self.user.credit, 11)
        self.assertEqual(CreditLog.objects.filter(user=self.user).count(), 1)
        self.assertEqual(CampaignCallbackEvent.objects.count(), 1)

    def test_definitive_blocked_no_device_and_dispatch_failure_release_once(self):
        for index, reason in enumerate(("blocked", "no_device", "dispatch_failed")):
            with self.subTest(reason=reason):
                campaign = self.reserve(number=f"91999999999{index}")
                response = self.callback(campaign, f"job-{index}:failed", "failed", reason=reason)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["status"], "ok")
                self.user.refresh_from_db()
                campaign.refresh_from_db()
                self.assertEqual(self.user.credit, 12)
                self.assertEqual(campaign.status, "failed")
                self.assertFalse(campaign.credit_reserved)

    def test_duplicate_callback_is_idempotent_and_conflicting_replay_is_rejected(self):
        campaign = self.reserve()
        first = self.callback(campaign, "job-dup:failed", "failed", reason="no_device")
        duplicate = self.callback(campaign, "job-dup:failed", "failed", reason="no_device")
        conflict = self.callback(campaign, "job-dup:failed", "failed", reason="blocked")
        self.assertEqual(first.data["status"], "ok")
        self.assertEqual(duplicate.data["status"], "duplicate")
        self.assertEqual(conflict.status_code, 409)
        self.user.refresh_from_db()
        self.assertEqual(self.user.credit, 12)
        self.assertEqual(CreditLog.objects.filter(user=self.user).count(), 2)
        self.assertEqual(CampaignCallbackEvent.objects.count(), 1)

    def test_pending_approval_and_missing_callback_do_not_release_credit(self):
        campaign = self.reserve()
        # The browser's approval_pending response does not call Django. This
        # also models an HTTP timeout where no final outcome can be trusted.
        self.user.refresh_from_db()
        self.assertEqual(self.user.credit, 11)
        self.assertEqual(campaign.status, "pending")
        self.assertTrue(campaign.credit_reserved)
        self.assertEqual(campaign.callback_events.count(), 0)

    def test_timeout_unknown_callback_holds_credit_until_later_final_callback(self):
        campaign = self.reserve()
        unknown = self.callback(campaign, "job-timeout:unknown", "unknown", reason="timeout")
        self.assertEqual(unknown.data["status"], "unknown")
        campaign.refresh_from_db()
        self.user.refresh_from_db()
        self.assertEqual(campaign.status, "pending")
        self.assertTrue(campaign.credit_reserved)
        self.assertEqual(self.user.credit, 11)

        final = self.callback(
            campaign, "job-timeout:completed", "completed",
            results=[{"number": "919999999999", "status": "sent"}],
        )
        self.assertEqual(final.data["status"], "ok")
        campaign.refresh_from_db()
        self.user.refresh_from_db()
        self.assertEqual(campaign.status, "completed")
        self.assertFalse(campaign.credit_reserved)
        self.assertEqual(self.user.credit, 11)
        self.assertEqual(campaign.callback_events.count(), 2)

    def test_callback_cannot_claim_more_results_than_the_reservation(self):
        campaign = self.reserve()
        response = self.callback(campaign, "job-overflow:completed", "completed", results=[
            {"number": f"91999999999{i}", "status": "sent"} for i in range(1, 3)
        ])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(campaign.callback_events.count(), 0)
        self.user.refresh_from_db()
        self.assertEqual(self.user.credit, 11)

    def test_completed_callback_requires_exact_unique_reserved_recipients_and_known_statuses(self):
        campaign = self.reserve()
        invalid_callbacks = [
            ("missing-result", []),
            ("wrong-recipient", [{"number": "919999999998", "status": "sent"}]),
            ("duplicate-recipient", [
                {"number": "919999999999", "status": "sent"},
                {"number": "919999999999", "status": "failed"},
            ]),
            ("unknown-status", [{"number": "919999999999", "status": "queued"}]),
        ]
        for event_id, results in invalid_callbacks:
            with self.subTest(event_id=event_id):
                response = self.callback(campaign, event_id, "completed", results=results)
                self.assertEqual(response.status_code, 400)
        campaign.refresh_from_db()
        self.user.refresh_from_db()
        self.assertEqual(campaign.status, "pending")
        self.assertTrue(campaign.credit_reserved)
        self.assertEqual(self.user.credit, 11)
        self.assertEqual(campaign.callback_events.count(), 0)

    def test_reservation_rejects_duplicate_or_malformed_recipients_before_debit(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.panel_token}")
        response = self.client.post("/api/send-whatsapp/", {
            "results": [
                {"number": "919999999999", "status": "pending"},
                {"number": "+91 99999 99999", "status": "pending"},
            ],
            "message": "hello", "total": 2, "user_id": self.user.pk,
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Campaign.objects.count(), 0)
        self.assertEqual(CreditLog.objects.count(), 0)
        self.user.refresh_from_db()
        self.assertEqual(self.user.credit, 12)

    def test_completed_callback_cannot_carry_failure_reason(self):
        campaign = self.reserve()
        response = self.callback(
            campaign, "job-invalid-reason", "completed", reason="no_device",
            results=[{"number": "919999999999", "status": "sent"}],
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(campaign.callback_events.count(), 0)
        self.user.refresh_from_db()
        self.assertEqual(self.user.credit, 11)

    def test_admin_campaign_failure_does_not_mint_credit(self):
        admin = User.objects.create(
            username="campaign-admin", password="hashed-value", role="admin",
            credit=999, status="Active",
        )
        admin_token = signing.dumps({"user_id": admin.pk, "token_version": admin.token_version}, salt="provider-panel-session")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {admin_token}")
        reservation = self.client.post("/api/send-whatsapp/", {
            "results": [{"number": "919999999999", "status": "pending"}],
            "message": "hello", "total": 1, "user_id": admin.pk, "status": "pending",
        }, format="json")
        campaign = Campaign.objects.get(pk=reservation.data["campaign_id"])
        self.assertFalse(campaign.credit_reserved)
        self.assertEqual(reservation.data["remaining_credit"], 999)
        failed = self.callback(campaign, "admin-job:no-device", "failed", reason="no_device")
        self.assertEqual(failed.data["status"], "ok")
        admin.refresh_from_db()
        self.assertEqual(admin.credit, 999)
        self.assertFalse(CreditLog.objects.filter(user=admin).exists())

