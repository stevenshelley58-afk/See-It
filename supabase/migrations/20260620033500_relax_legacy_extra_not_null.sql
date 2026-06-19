do $$
declare
  legacy_table text;
  legacy_column text;
  expected_columns text[];
begin
  foreach legacy_table in array array['shop', 'product_setup', 'room_session', 'render_feedback', 'event_log']
  loop
    expected_columns := case legacy_table
      when 'shop' then array[
        'id',
        'shop_domain',
        'shop_name',
        'contact_email',
        'shopify_shop_id',
        'offline_access_token_encrypted',
        'access_scopes',
        'plan',
        'trial_ends_at',
        'renders_quota',
        'lifestyle_images_quota',
        'billing_subscription_id',
        'billing_status',
        'room_preview_enabled',
        'debug_asset_retention_enabled',
        'installed_at',
        'uninstalled_at',
        'created_at',
        'updated_at'
      ]
      when 'product_setup' then array[
        'id',
        'shop_id',
        'shopify_product_gid',
        'shopify_product_handle',
        'title',
        'width_mm',
        'height_mm',
        'depth_mm',
        'category',
        'material',
        'colour',
        'merchant_notes',
        'primary_image_key',
        'cutout_key',
        'prep_status',
        'enabled',
        'created_at',
        'updated_at'
      ]
      when 'room_session' then array[
        'id',
        'shop_id',
        'product_setup_id',
        'source',
        'room_key',
        'normalized_room_key',
        'verified',
        'width',
        'height',
        'expires_at',
        'created_at',
        'last_activity_at'
      ]
      when 'render_feedback' then array['id', 'render_request_id', 'verdict', 'issue_tag', 'comment', 'created_at']
      when 'event_log' then array[
        'id',
        'ts',
        'surface',
        'name',
        'shop_id',
        'prospect_id',
        'render_request_id',
        'product_setup_id',
        'ai_invocation_id',
        'props_json'
      ]
    end;

    for legacy_column in
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = legacy_table
        and is_nullable = 'NO'
        and not (column_name = any(expected_columns))
    loop
      execute format('alter table public.%I alter column %I drop not null', legacy_table, legacy_column);
    end loop;
  end loop;
end $$;
