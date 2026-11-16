from django.urls import path
from . import views
from . import provider_views

urlpatterns = [

    # 🔐 AUTH
    path("login/", views.login),
    path("setup-admin/", views.setup_admin),

    # 👤 USER
    path("create-user/", views.create_user),
    path("get-users/", views.get_users),
    path("update-user/", views.update_user),
    path("delete-user/", views.delete_user),
    path("toggle-status/", views.toggle_user_status),
    path("reset-password/", views.reset_password),

    # 📲 CAMPAIGN
    path("send-whatsapp/", views.send_whatsapp),
    path("get-credit-logs/", views.get_credit_logs),
    path("get-campaigns/", views.get_campaigns),
    path("get-user/", views.get_user),

    # 🔌 Provider integrations (credentials remain in the Django environment)
    path("provider/status/", provider_views.provider_status),
    path("provider/webhook/inbound/", provider_views.provider_webhook_inbound),
    path("provider/dispatch/", provider_views.provider_dispatch),
    path("provider/templates/", provider_views.provider_templates),
    path("provider/templates/sync/", provider_views.provider_template_sync),
    path("provider/templates/<str:template_id>/", provider_views.provider_template_detail),
    path("provider/meta/templates/", provider_views.provider_meta_templates),
    path("provider/meta/resource/<str:resource_id>/", provider_views.provider_meta_resource),
    path("provider/meta/template/<str:template_id>/", provider_views.provider_meta_template_edit),
    path("provider/meta/channels/", provider_views.provider_meta_channels),
    path("provider/meta/messages/", provider_views.provider_meta_message),
    path("provider/meta/media/", provider_views.provider_meta_media),
]

