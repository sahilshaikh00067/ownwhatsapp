import os
from unittest.mock import Mock, patch

from django.core import signing
from django.core.files.uploadedfile import SimpleUploadedFile
from django.contrib.auth.hashers import check_password
from django.test import override_settings
from django.urls import resolve
from rest_framework.test import APITestCase

from .models import ProviderApiAudit, ProviderSyncState, ProviderTemplateCache, ProviderWebhookEvent, User


@override_settings(SECRET_KEY="test-signing-key-only")
class ProviderApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create(username="api-tester", password="secret", status="Active", role="admin")
        self.token = signing.dumps({"user_id": self.user.id, "token_version": self.user.token_version}, salt="provider-panel-session")
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}
        self.env = patch.dict(os.environ, {
            "WBOX_API_BASE_URL": "https://provider.example",
            "WBOX_API_TOKEN": "server-only-test-token",
            "WBOX_META_VERSION": "v23.0",
            "WBOX_WABA_ID": "123456",
            "WBOX_PHONE_NUMBER_ID": "789012",
            "WBOX_WEBHOOK_SECRET": "webhook-test-secret",
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    @staticmethod
    def upstream(status=200, body=None):
        response = Mock()
        response.status_code = status
        response.ok = 200 <= status < 400
        response.json.return_value = {"accepted": True} if body is None else body
        response.text = ""
        return response

    def test_all_16_documented_operations_are_routed_server_side(self):
        fake_request = Mock(return_value=self.upstream())
        with patch("api.provider_views.requests.request", fake_request):
            # 1. Wallet balance
            self.assertEqual(self.client.post("/api/provider/dispatch/", {"operation": "balance"},
                                              format="json", **self.auth).status_code, 200)
            # 2-4. Marketing connectors
            for connector in ("clevertap", "moengage", "webengage"):
                response = self.client.post("/api/provider/dispatch/", {"operation": connector, "payload": {"data": []}},
                                            format="json", **self.auth)
                self.assertEqual(response.status_code, 200)
            # 5. Local template list
            self.assertEqual(self.client.get("/api/provider/templates/?page=2&limit=25&template_name=welcome",
                                             **self.auth).status_code, 200)
            # 6. Local template detail
            self.assertEqual(self.client.get("/api/provider/templates/175902/", **self.auth).status_code, 200)
            # 7. Template sync
            self.assertEqual(self.client.post("/api/provider/templates/sync/", {
                "startDate": "2026-01-01T00:00:00Z", "endDate": "2026-01-02T00:00:00Z",
            }, format="json", **self.auth).status_code, 200)
            # 8. Provider webhook API
            self.assertEqual(self.client.post("/api/provider/dispatch/", {"operation": "webhook", "payload": {"event": "test"}},
                                              format="json", **self.auth).status_code, 200)
            # 9. Meta template list
            self.assertEqual(self.client.get("/api/provider/meta/templates/?limit=30&after=cursor",
                                             **self.auth).status_code, 200)
            # 10. Meta template create
            self.assertEqual(self.client.post("/api/provider/meta/templates/", {"payload": {
                "name": "integration_test", "language": "en", "category": "UTILITY",
            }}, format="json", **self.auth).status_code, 200)
            # 11. Meta template delete
            self.assertEqual(self.client.delete("/api/provider/meta/templates/?hsm_id=12&name=old_template",
                                                **self.auth).status_code, 200)
            # 12. Template/media resource lookup
            self.assertEqual(self.client.get("/api/provider/meta/resource/987/?phone_number_id=789012",
                                             **self.auth).status_code, 200)
            # 13. Meta template edit
            self.assertEqual(self.client.post("/api/provider/meta/template/987/", {"payload": {"category": "UTILITY"}},
                                              format="json", **self.auth).status_code, 200)
            # 14. WhatsApp message send
            self.assertEqual(self.client.post("/api/provider/meta/messages/", {
                "to_number": "919000000000", "payload": {"type": "text", "text": {"body": "test"}},
            }, format="json", **self.auth).status_code, 200)
            # 15. Channel list
            self.assertEqual(self.client.get("/api/provider/meta/channels/", **self.auth).status_code, 200)
            # 16. Media upload
            upload = SimpleUploadedFile("test.avif", b"avif bytes", content_type="image/avif")
            self.assertEqual(self.client.post("/api/provider/meta/media/", {"file": upload}, format="multipart",
                                              **self.auth).status_code, 200)

        self.assertEqual(fake_request.call_count, 16)
        self.assertEqual(
            [(call.args[0], call.args[1].removeprefix("https://provider.example"))
             for call in fake_request.call_args_list],
            [
                ("GET", "/api/v1/user/balance"),
                ("POST", "/api/v1/meta/clevertap"),
                ("POST", "/api/v1/meta/moengage"),
                ("POST", "/api/v1/meta/webengage"),
                ("GET", "/api/v1/meta/templates"),
                ("GET", "/api/v1/meta/templates/175902"),
                ("POST", "/api/v1/meta/templates/sync"),
                ("POST", "/api/v1/meta/webhook"),
                ("GET", "/v23.0/123456/message_templates"),
                ("POST", "/v23.0/123456/message_templates"),
                ("DELETE", "/v23.0/123456/message_templates"),
                ("GET", "/v23.0/987"),
                ("POST", "/v23.0/987"),
                ("POST", "/v23.0/789012/messages"),
                ("GET", "/v23.0/channels"),
                ("POST", "/v23.0/789012/media"),
            ],
        )
        self.assertEqual(ProviderApiAudit.objects.count(), 16)
        self.assertTrue(all(call.kwargs["headers"]["Authorization"] == "Bearer server-only-test-token"
                            for call in fake_request.call_args_list))
        self.assertEqual(ProviderSyncState.objects.get(name="whatsapp_templates").status, "success")
        self.assertNotIn("server-only-test-token", str(ProviderApiAudit.objects.values().first()))

    def test_panel_token_is_required_and_login_issues_one(self):
        response = self.client.get("/api/provider/status/")
        self.assertEqual(response.status_code, 401)
        response = self.client.post("/api/login/", {"username": "api-tester", "password": "secret"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["panel_token"])
        self.assertTrue(signing.loads(response.data["panel_token"], salt="provider-panel-session"))
        self.user.refresh_from_db()
        self.assertTrue(check_password("secret", self.user.password))
        second_login = self.client.post("/api/login/", {"username": "api-tester", "password": "secret"}, format="json")
        self.assertEqual(second_login.status_code, 200)

    def test_existing_auth_campaign_and_credit_routes_remain_registered(self):
        for route in ("/api/login/", "/api/send-whatsapp/", "/api/get-campaigns/", "/api/get-credit-logs/"):
            with self.subTest(route=route):
                self.assertIsNotNone(resolve(route))

    def test_admin_bootstrap_requires_environment_secret_and_is_one_time(self):
        with patch.dict(os.environ, {"ADMIN_SETUP_TOKEN": "", "ADMIN_SETUP_PASSWORD": ""}):
            unavailable = self.client.post("/api/setup-admin/", {}, format="json")
        self.assertEqual(unavailable.status_code, 503)

        with patch.dict(os.environ, {"ADMIN_SETUP_TOKEN": "bootstrap-test-token", "ADMIN_SETUP_PASSWORD": "Initial-Secret-2026"}):
            denied = self.client.post("/api/setup-admin/", {}, format="json")
            self.assertEqual(denied.status_code, 403)
            created = self.client.post("/api/setup-admin/", {}, format="json",
                                       HTTP_AUTHORIZATION="Bearer bootstrap-test-token")
            self.assertEqual(created.status_code, 200)
            admin = User.objects.get(username="admin")
            self.assertTrue(check_password("Initial-Secret-2026", admin.password))
            duplicate = self.client.post("/api/setup-admin/", {}, format="json",
                                         HTTP_AUTHORIZATION="Bearer bootstrap-test-token")
        self.assertEqual(duplicate.status_code, 409)

    @override_settings(SECRET_KEY="django-insecure-development-key")
    def test_provider_routes_require_a_non_default_django_signing_key(self):
        response = self.client.get("/api/provider/status/", **self.auth)
        self.assertEqual(response.status_code, 503)
        self.assertIn("DJANGO_SECRET_KEY", response.data["error"])

    def test_webhook_receiver_authenticates_and_stores_only_metadata(self):
        denied = self.client.post("/api/provider/webhook/inbound/", {"type": "message", "id": "event-1"}, format="json")
        self.assertEqual(denied.status_code, 401)
        accepted = self.client.post("/api/provider/webhook/inbound/", {"type": "message", "id": "event-1"},
                                   format="json", HTTP_AUTHORIZATION="Bearer webhook-test-secret")
        self.assertEqual(accepted.status_code, 202)
        event = ProviderWebhookEvent.objects.get()
        self.assertEqual((event.event_id, event.event_type), ("event-1", "message"))
        self.assertFalse(hasattr(event, "payload"))

    def test_provider_template_metadata_is_cached(self):
        response = self.upstream(body={"templates": [{
            "id": 175902, "template_id": "2120624728817171", "name": "welcome",
            "language": "en", "category_name": "UTILITY", "state": "APPROVED",
            "content": {"body": "Hello"}, "created_at": "2026-11-10T12:00:00",
        }]})
        with patch("api.provider_views.requests.request", return_value=response):
            result = self.client.get("/api/provider/templates/", **self.auth)
        self.assertEqual(result.status_code, 200)
        template = ProviderTemplateCache.objects.get(external_id="175902")
        self.assertEqual((template.name, template.state, template.content["body"]), ("welcome", "APPROVED", "Hello"))

    def test_non_admin_cannot_trigger_provider_side_effects(self):
        self.user.role = "user"
        self.user.save(update_fields=["role"])
        self.token = signing.dumps({"user_id": self.user.id, "token_version": self.user.token_version}, salt="provider-panel-session")
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}
        with patch("api.provider_views.requests.request") as fake_request:
            response = self.client.post("/api/provider/meta/messages/", {
                "to_number": "919000000000", "payload": {"type": "text"},
            }, format="json", **self.auth)
        self.assertEqual(response.status_code, 403)
        fake_request.assert_not_called()

    def test_non_admin_cannot_read_shared_provider_account_data(self):
        self.user.role = "user"
        self.user.save(update_fields=["role"])
        self.token = signing.dumps({"user_id": self.user.id, "token_version": self.user.token_version}, salt="provider-panel-session")
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}
        with patch("api.provider_views.requests.request") as fake_request:
            status = self.client.get("/api/provider/status/", **self.auth)
            balance = self.client.post("/api/provider/dispatch/", {"operation": "balance"}, format="json", **self.auth)
        self.assertEqual(status.status_code, 403)
        self.assertEqual(balance.status_code, 403)
        fake_request.assert_not_called()

    def test_validation_configuration_and_provider_failures(self):
        with patch("api.provider_views.requests.request") as fake_request:
            bad_filter = self.client.get("/api/provider/templates/?limit=1000", **self.auth)
            self.assertEqual(bad_filter.status_code, 400)
            bad_sync = self.client.post("/api/provider/templates/sync/", {"startDate": "later"},
                                        format="json", **self.auth)
            self.assertEqual(bad_sync.status_code, 400)
            mismatched_recipient = self.client.post("/api/provider/meta/messages/", {
                "to_number": "919000000000", "payload": {"to": "919000000001"},
            }, format="json", **self.auth)
            self.assertEqual(mismatched_recipient.status_code, 400)
            self.assertEqual(fake_request.call_count, 0)

        with patch.dict(os.environ, {"WBOX_API_TOKEN": ""}):
            missing = self.client.post("/api/provider/dispatch/", {"operation": "balance"}, format="json", **self.auth)
            self.assertEqual(missing.status_code, 503)

        with patch("api.provider_views.requests.request", return_value=self.upstream(status=500, body={"error": "bad payload"})):
            rejected = self.client.post("/api/provider/dispatch/", {"operation": "clevertap", "payload": {}},
                                        format="json", **self.auth)
            self.assertEqual(rejected.status_code, 500)
            self.assertEqual(rejected.data["data"]["error"], "bad payload")
        self.assertFalse(ProviderApiAudit.objects.filter(safe_message="completed").exists())

    def test_network_error_is_reported_without_exposing_credentials(self):
        with patch("api.provider_views.requests.request", side_effect=__import__("requests").Timeout()):
            response = self.client.post("/api/provider/dispatch/", {"operation": "balance"}, format="json", **self.auth)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("server-only-test-token", str(response.data))

