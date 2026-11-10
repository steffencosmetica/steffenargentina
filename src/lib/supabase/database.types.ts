
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admin_users": {
                  Row: {
                    "created_at": string,"note": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"note"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"note"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"image_path": string | null,"is_active": boolean,"name": string,"slug": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"name": string,"slug": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"name"?: string,"slug"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"checkout_attempts": {
                  Row: {
                    "created_at": string,"error_code": string | null,"id": number,"ip_hash": string,"order_id": string | null,"outcome": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"error_code"?: string | null,"id"?: never,"ip_hash": string,"order_id"?: string | null,"outcome": string
                  }
                  Update: {
                    "created_at"?: string,"error_code"?: string | null,"id"?: never,"ip_hash"?: string,"order_id"?: string | null,"outcome"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checkout_attempts_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"order_events": {
                  Row: {
                    "actor": string,"actor_user_id": string | null,"created_at": string,"data": NonNullable<Json>,"event_type": string,"id": number,"order_id": string,"payment_ref": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": string,"actor_user_id"?: string | null,"created_at"?: string,"data"?: NonNullable<Json>,"event_type": string,"id"?: never,"order_id": string,"payment_ref"?: string | null
                  }
                  Update: {
                    "actor"?: string,"actor_user_id"?: string | null,"created_at"?: string,"data"?: NonNullable<Json>,"event_type"?: string,"id"?: never,"order_id"?: string,"payment_ref"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_events_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "id": string,"line_total_ars": number,"name": string,"order_id": string,"product_id": string,"quantity": number,"sku": string,"unit_price_ars": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"line_total_ars": number,"name": string,"order_id": string,"product_id": string,"quantity": number,"sku": string,"unit_price_ars": number
                  }
                  Update: {
                    "id"?: string,"line_total_ars"?: number,"name"?: string,"order_id"?: string,"product_id"?: string,"quantity"?: number,"sku"?: string,"unit_price_ars"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "access_token_hash": string,"admin_notes": string | null,"admin_version": number,"buyer_document": string | null,"buyer_email": string,"buyer_name": string,"buyer_phone": string,"cancelled_at": string | null,"code": string,"created_at": string,"delivered_at": string | null,"dispatch_carrier": string | null,"dispatch_tracking": string | null,"dispatched_at": string | null,"fulfillment_status": string,"id": string,"idempotency_key_hash": string,"paid_at": string | null,"payment_status": string,"request_fingerprint": string,"reservation_expires_at": string,"resolution_reason": string | null,"resolution_status": string,"ship_city": string,"ship_notes": string | null,"ship_number": string,"ship_postal_code": string,"ship_province_code": string,"ship_street": string,"ship_unit": string | null,"shipping_ars": number,"shipping_free_from_ars": number | null,"shipping_rate_ars": number,"shipping_zone_id": string | null,"shipping_zone_name": string,"stock_released_at": string | null,"stock_state": string,"subtotal_ars": number,"token_key_version": number,"total_ars": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_token_hash": string,"admin_notes"?: string | null,"admin_version"?: number,"buyer_document"?: string | null,"buyer_email": string,"buyer_name": string,"buyer_phone": string,"cancelled_at"?: string | null,"code": string,"created_at"?: string,"delivered_at"?: string | null,"dispatch_carrier"?: string | null,"dispatch_tracking"?: string | null,"dispatched_at"?: string | null,"fulfillment_status"?: string,"id"?: string,"idempotency_key_hash": string,"paid_at"?: string | null,"payment_status"?: string,"request_fingerprint": string,"reservation_expires_at": string,"resolution_reason"?: string | null,"resolution_status"?: string,"ship_city": string,"ship_notes"?: string | null,"ship_number": string,"ship_postal_code": string,"ship_province_code": string,"ship_street": string,"ship_unit"?: string | null,"shipping_ars": number,"shipping_free_from_ars"?: number | null,"shipping_rate_ars": number,"shipping_zone_id"?: string | null,"shipping_zone_name": string,"stock_released_at"?: string | null,"stock_state"?: string,"subtotal_ars": number,"token_key_version": number,"total_ars": number,"updated_at"?: string
                  }
                  Update: {
                    "access_token_hash"?: string,"admin_notes"?: string | null,"admin_version"?: number,"buyer_document"?: string | null,"buyer_email"?: string,"buyer_name"?: string,"buyer_phone"?: string,"cancelled_at"?: string | null,"code"?: string,"created_at"?: string,"delivered_at"?: string | null,"dispatch_carrier"?: string | null,"dispatch_tracking"?: string | null,"dispatched_at"?: string | null,"fulfillment_status"?: string,"id"?: string,"idempotency_key_hash"?: string,"paid_at"?: string | null,"payment_status"?: string,"request_fingerprint"?: string,"reservation_expires_at"?: string,"resolution_reason"?: string | null,"resolution_status"?: string,"ship_city"?: string,"ship_notes"?: string | null,"ship_number"?: string,"ship_postal_code"?: string,"ship_province_code"?: string,"ship_street"?: string,"ship_unit"?: string | null,"shipping_ars"?: number,"shipping_free_from_ars"?: number | null,"shipping_rate_ars"?: number,"shipping_zone_id"?: string | null,"shipping_zone_name"?: string,"stock_released_at"?: string | null,"stock_state"?: string,"subtotal_ars"?: number,"token_key_version"?: number,"total_ars"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_ship_province_code_fkey"
      columns: ["ship_province_code"]
isOneToOne: false
      referencedRelation: "provinces"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "orders_shipping_zone_id_fkey"
      columns: ["shipping_zone_id"]
isOneToOne: false
      referencedRelation: "shipping_zones"
      referencedColumns: ["id"]
    }
                  ]
                },"product_images": {
                  Row: {
                    "alt_text": string | null,"created_at": string,"id": string,"is_primary": boolean,"product_id": string,"sort_order": number,"storage_path": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alt_text"?: string | null,"created_at"?: string,"id"?: string,"is_primary"?: boolean,"product_id": string,"sort_order"?: number,"storage_path": string,"updated_at"?: string
                  }
                  Update: {
                    "alt_text"?: string | null,"created_at"?: string,"id"?: string,"is_primary"?: boolean,"product_id"?: string,"sort_order"?: number,"storage_path"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "availability": string | null,"benefits": string | null,"category_id": string,"created_at": string,"description": string | null,"id": string,"is_active": boolean,"is_featured": boolean,"name": string,"package_height_mm": number | null,"package_length_mm": number | null,"package_width_mm": number | null,"presentation": string | null,"price_ars": number,"short_description": string | null,"sku": string,"slug": string,"sort_order": number,"stock": number,"stock_version": number,"updated_at": string,"usage_instructions": string | null,"weight_grams": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "availability"?: never,"benefits"?: string | null,"category_id": string,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"is_featured"?: boolean,"name": string,"package_height_mm"?: number | null,"package_length_mm"?: number | null,"package_width_mm"?: number | null,"presentation"?: string | null,"price_ars": number,"short_description"?: string | null,"sku": string,"slug": string,"sort_order"?: number,"stock"?: number,"stock_version"?: number,"updated_at"?: string,"usage_instructions"?: string | null,"weight_grams"?: number | null
                  }
                  Update: {
                    "availability"?: never,"benefits"?: string | null,"category_id"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"is_featured"?: boolean,"name"?: string,"package_height_mm"?: number | null,"package_length_mm"?: number | null,"package_width_mm"?: number | null,"presentation"?: string | null,"price_ars"?: number,"short_description"?: string | null,"sku"?: string,"slug"?: string,"sort_order"?: number,"stock"?: number,"stock_version"?: number,"updated_at"?: string,"usage_instructions"?: string | null,"weight_grams"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"provinces": {
                  Row: {
                    "code": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"name": string
                  }
                  Update: {
                    "code"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"revocation_events": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"id": number,"request_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"id"?: never,"request_id": string,"status": string
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"id"?: never,"request_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "revocation_events_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "revocation_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"revocation_message_attempts": {
                  Row: {
                    "attempt": number,"error_code": string | null,"error_detail": string | null,"finished_at": string | null,"id": number,"message_id": string,"outcome": string | null,"started_at": string,"worker": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt": number,"error_code"?: string | null,"error_detail"?: string | null,"finished_at"?: string | null,"id"?: never,"message_id": string,"outcome"?: string | null,"started_at"?: string,"worker": string
                  }
                  Update: {
                    "attempt"?: number,"error_code"?: string | null,"error_detail"?: string | null,"finished_at"?: string | null,"id"?: never,"message_id"?: string,"outcome"?: string | null,"started_at"?: string,"worker"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "revocation_message_attempts_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "revocation_messages"
      referencedColumns: ["id"]
    }
                  ]
                },"revocation_message_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"from_status": string | null,"id": number,"message_id": string,"note": string | null,"to_status": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"from_status"?: string | null,"id"?: never,"message_id": string,"note"?: string | null,"to_status"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"from_status"?: string | null,"id"?: never,"message_id"?: string,"note"?: string | null,"to_status"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "revocation_message_events_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "revocation_messages"
      referencedColumns: ["id"]
    }
                  ]
                },"revocation_messages": {
                  Row: {
                    "accepted_at": string | null,"attempts": number,"created_at": string,"id": string,"kind": string,"last_attempt_at": string | null,"last_error": string | null,"last_error_code": string | null,"lease_id": string | null,"locked_until": string | null,"max_attempts": number,"next_attempt_at": string,"provider_message_id": string | null,"recipient": string,"related_message_id": string | null,"request_id": string | null,"status": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"attempts"?: number,"created_at"?: string,"id"?: string,"kind": string,"last_attempt_at"?: string | null,"last_error"?: string | null,"last_error_code"?: string | null,"lease_id"?: string | null,"locked_until"?: string | null,"max_attempts"?: number,"next_attempt_at"?: string,"provider_message_id"?: string | null,"recipient": string,"related_message_id"?: string | null,"request_id"?: string | null,"status"?: string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "accepted_at"?: string | null,"attempts"?: number,"created_at"?: string,"id"?: string,"kind"?: string,"last_attempt_at"?: string | null,"last_error"?: string | null,"last_error_code"?: string | null,"lease_id"?: string | null,"locked_until"?: string | null,"max_attempts"?: number,"next_attempt_at"?: string,"provider_message_id"?: string | null,"recipient"?: string,"related_message_id"?: string | null,"request_id"?: string | null,"status"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "revocation_messages_related_message_id_fkey"
      columns: ["related_message_id"]
isOneToOne: false
      referencedRelation: "revocation_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "revocation_messages_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "revocation_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"revocation_requests": {
                  Row: {
                    "code": string,"contact_email": string,"id": string,"idempotency_key": string,"ip_hash": string,"purchase_reference": string,"received_at": string,"status": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code"?: string,"contact_email": string,"id"?: string,"idempotency_key": string,"ip_hash": string,"purchase_reference": string,"received_at"?: string,"status"?: string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "code"?: string,"contact_email"?: string,"id"?: string,"idempotency_key"?: string,"ip_hash"?: string,"purchase_reference"?: string,"received_at"?: string,"status"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"shipping_zone_provinces": {
                  Row: {
                    "province_code": string,"zone_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "province_code": string,"zone_id": string
                  }
                  Update: {
                    "province_code"?: string,"zone_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shipping_zone_provinces_province_code_fkey"
      columns: ["province_code"]
isOneToOne: true
      referencedRelation: "provinces"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "shipping_zone_provinces_zone_id_fkey"
      columns: ["zone_id"]
isOneToOne: false
      referencedRelation: "shipping_zones"
      referencedColumns: ["id"]
    }
                  ]
                },"shipping_zones": {
                  Row: {
                    "created_at": string,"free_from_ars": number | null,"id": string,"is_active": boolean,"name": string,"price_ars": number,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"free_from_ars"?: number | null,"id"?: string,"is_active"?: boolean,"name": string,"price_ars": number,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"free_from_ars"?: number | null,"id"?: string,"is_active"?: boolean,"name"?: string,"price_ars"?: number,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"store_settings": {
                  Row: {
                    "checkout_enabled": boolean,"id": boolean,"max_attempts_per_ip_hour": number,"max_orders_per_ip_hour": number,"max_pending_orders_per_email": number,"max_units_per_order": number,"max_units_per_product": number,"reservation_minutes": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "checkout_enabled"?: boolean,"id"?: boolean,"max_attempts_per_ip_hour"?: number,"max_orders_per_ip_hour"?: number,"max_pending_orders_per_email"?: number,"max_units_per_order"?: number,"max_units_per_product"?: number,"reservation_minutes"?: number,"updated_at"?: string
                  }
                  Update: {
                    "checkout_enabled"?: boolean,"id"?: boolean,"max_attempts_per_ip_hour"?: number,"max_orders_per_ip_hour"?: number,"max_pending_orders_per_email"?: number,"max_units_per_order"?: number,"max_units_per_product"?: number,"reservation_minutes"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            iniciar_intento_pago: { Args: { p_code: string; p_token: string; p_client_ip: string }; Returns: Json };
            finalizar_intento_pago: {
              Args: { p_id: string; p_lease: string; p_provider_order_id: string | null; p_error: string | null };
              Returns: boolean;
            };
            simular_order_pago: { Args: { p_key: string; p_lease: string; p_reference: string; p_total: string }; Returns: string | null };
            buscar_order_pago_simulada: {
              Args: { p_id: string | null; p_reference: string | null; p_begin: string | null; p_end: string | null };
              Returns: Json;
            };
            "admin_actualizar_limites":
{ Args: { "p_max_attempts_per_ip_hour": number,"p_max_orders_per_ip_hour": number,"p_max_pending_orders_per_email": number,"p_max_units_per_order": number,"p_max_units_per_product": number,"p_reservation_minutes": number }; Returns: {
              "checkout_enabled": boolean,
"id": boolean,
"max_attempts_per_ip_hour": number,
"max_orders_per_ip_hour": number,
"max_pending_orders_per_email": number,
"max_units_per_order": number,
"max_units_per_product": number,
"reservation_minutes": number,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "store_settings"
        isOneToOne: true
        isSetofReturn: false
      } },
"admin_actualizar_notas":
{ Args: { "p_notes": string,"p_order_id": string }; Returns: undefined
                           },
"admin_actualizar_preparacion":
{ Args: { "p_carrier"?: string,"p_order_id": string,"p_status": string,"p_tracking"?: string }; Returns: undefined
                           },
"admin_cancelar_pedido":
{ Args: { "p_order_id": string }; Returns: undefined
                           },
"admin_estado_comunicaciones":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_gestionar_arrepentimiento":
{ Args: { "p_id": string,"p_status": string,"p_version": number }; Returns: undefined
                           },
"admin_intervenir_comunicacion":
{ Args: { "p_action": string,"p_id": string,"p_note": string,"p_version": number }; Returns: undefined
                           },
"admin_listar_pedidos":
{ Args: { "p_filters": Json,"p_page"?: number }; Returns: Json
                           },
"admin_marcar_resuelto":
{ Args: { "p_order_id": string }; Returns: undefined
                           },
"admin_operar_pedido":
{ Args: { "p_carrier"?: string,"p_dispatched_at"?: string,"p_notes"?: string,"p_operation": string,"p_order_id": string,"p_tracking"?: string,"p_version": number }; Returns: undefined
                           },
"admin_product_stock":
{ Args: { "p_ids"?: (string)[] }; Returns: {
              "id": string,"stock": number,"stock_version": number
            }[]
                           },
"admin_resolver_faltante":
{ Args: { "p_order_id": string }; Returns: undefined
                           },
"admin_save_zone":
{ Args: { "p_codes": (string)[],"p_free_from_ars": number,"p_id": string,"p_is_active": boolean,"p_move"?: boolean,"p_name": string,"p_price_ars": number }; Returns: {
              "added": (string)[],"moved": (string)[],"removed": (string)[],"zone_id": string
            }[]
                           },
"admin_set_zone_provinces":
{ Args: { "p_codes": (string)[],"p_move"?: boolean,"p_zone_id": string }; Returns: {
              "added": (string)[],"moved": (string)[],"removed": (string)[]
            }[]
                           },
"canjear_constancia_arrepentimiento":
{ Args: { "p_ip": unknown,"p_token": string }; Returns: Json
                           },
"comunicaciones_reclamar":
{ Args: { "p_lease_seconds"?: number,"p_limit"?: number,"p_worker": string }; Returns: {
              "attempt": number,"id": string,"kind": string,"lease_id": string,"payload": Json,"recipient": string
            }[]
                           },
"comunicaciones_resultado":
{ Args: { "p_error_code"?: string,"p_error_detail"?: string,"p_id": string,"p_lease": string,"p_outcome": string,"p_provider_id"?: string }; Returns: string
                           },
"configuracion_checkout":
{ Args: Record<PropertyKey, never>; Returns: {
              "checkout_enabled": boolean,"max_units_per_order": number,"max_units_per_product": number,"reservation_minutes": number
            }[]
                           },
"consultar_pedido":
{ Args: { "p_code": string,"p_token": string }; Returns: Json
                           },
"cotizar_carrito":
{ Args: { "p_items": Json }; Returns: Json
                           },
"cotizar_envio":
{ Args: { "p_province_code": string,"p_subtotal_ars": number }; Returns: {
              "cost_ars": number,"free_from_ars": number,"has_coverage": boolean,"is_free": boolean,"rate_ars": number,"zone_id": string,"zone_name": string
            }[]
                           },
"crear_pedido":
{ Args: { "p_buyer": Json,"p_client_ip": unknown,"p_expected_total_ars": number,"p_idempotency_key": string,"p_items": Json,"p_shipping": Json }; Returns: Json
                           },
"estado_comunicaciones":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"liberar_reservas_vencidas":
{ Args: { "p_limite"?: number }; Returns: number
                           },
"provincias_cobertura":
{ Args: Record<PropertyKey, never>; Returns: {
              "code": string,"has_coverage": boolean,"name": string
            }[]
                           },
"purgar_intentos_checkout":
{ Args: { "p_dias"?: number }; Returns: number
                           },
"registrar_arrepentimiento":
{ Args: { "p_email": string,"p_ip": unknown,"p_key": string,"p_reference": string }; Returns: Json
                           },
"set_primary_product_image":
{ Args: { "p_image_id": string }; Returns: undefined
                           },
"solicitar_recuperacion_arrepentimiento":
{ Args: { "p_email": string,"p_ip": unknown }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
