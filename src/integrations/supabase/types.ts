export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      charging_events: {
        Row: {
          avg_price_sek: number | null
          created_at: string | null
          ended_at: string | null
          event_type: string
          household_id: string | null
          id: string
          kwh_charged: number | null
          kwh_discharged: number | null
          started_at: string
        }
        Insert: {
          avg_price_sek?: number | null
          created_at?: string | null
          ended_at?: string | null
          event_type: string
          household_id?: string | null
          id?: string
          kwh_charged?: number | null
          kwh_discharged?: number | null
          started_at: string
        }
        Update: {
          avg_price_sek?: number | null
          created_at?: string | null
          ended_at?: string | null
          event_type?: string
          household_id?: string | null
          id?: string
          kwh_charged?: number | null
          kwh_discharged?: number | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "charging_events_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      grid_tariffs: {
        Row: {
          grid_company: string
          hour_of_day: number
          id: string
          is_weekend: boolean
          tariff_sek_kwh: number
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          grid_company: string
          hour_of_day: number
          id?: string
          is_weekend?: boolean
          tariff_sek_kwh: number
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          grid_company?: string
          hour_of_day?: number
          id?: string
          is_weekend?: boolean
          tariff_sek_kwh?: number
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      household_profiles: {
        Row: {
          area_m2: number | null
          battery_kwh: number | null
          car_model: string | null
          commuter_type: string | null
          created_at: string | null
          daily_km: number | null
          grid_company: string | null
          house_type: string
          id: string
          name: string
          price_area: string | null
        }
        Insert: {
          area_m2?: number | null
          battery_kwh?: number | null
          car_model?: string | null
          commuter_type?: string | null
          created_at?: string | null
          daily_km?: number | null
          grid_company?: string | null
          house_type?: string
          id?: string
          name: string
          price_area?: string | null
        }
        Update: {
          area_m2?: number | null
          battery_kwh?: number | null
          car_model?: string | null
          commuter_type?: string | null
          created_at?: string | null
          daily_km?: number | null
          grid_company?: string | null
          house_type?: string
          id?: string
          name?: string
          price_area?: string | null
        }
        Relationships: []
      }
      optimization_logs: {
        Row: {
          decision: string
          household_id: string | null
          id: string
          logged_at: string
          reason: string | null
          soc_pct: number | null
          spot_price_sek: number | null
        }
        Insert: {
          decision: string
          household_id?: string | null
          id?: string
          logged_at?: string
          reason?: string | null
          soc_pct?: number | null
          spot_price_sek?: number | null
        }
        Update: {
          decision?: string
          household_id?: string | null
          id?: string
          logged_at?: string
          reason?: string | null
          soc_pct?: number | null
          spot_price_sek?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "optimization_logs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_runs: {
        Row: {
          avg_price_paid: number | null
          ended_at: string | null
          household_id: string | null
          id: string
          optimization_mode: string
          period_from: string
          period_to: string
          scenarios: number | null
          started_at: string | null
          status: string | null
          total_saved_sek: number | null
        }
        Insert: {
          avg_price_paid?: number | null
          ended_at?: string | null
          household_id?: string | null
          id?: string
          optimization_mode: string
          period_from: string
          period_to: string
          scenarios?: number | null
          started_at?: string | null
          status?: string | null
          total_saved_sek?: number | null
        }
        Update: {
          avg_price_paid?: number | null
          ended_at?: string | null
          household_id?: string | null
          id?: string
          optimization_mode?: string
          period_from?: string
          period_to?: string
          scenarios?: number | null
          started_at?: string | null
          status?: string | null
          total_saved_sek?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "simulation_runs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      spot_prices: {
        Row: {
          created_at: string | null
          hour: string
          id: string
          price_area: string
          price_sek_kwh: number
          source: string | null
        }
        Insert: {
          created_at?: string | null
          hour: string
          id?: string
          price_area?: string
          price_sek_kwh: number
          source?: string | null
        }
        Update: {
          created_at?: string | null
          hour?: string
          id?: string
          price_area?: string
          price_sek_kwh?: number
          source?: string | null
        }
        Relationships: []
      }
      virtual_chargers: {
        Row: {
          created_at: string | null
          current_soc: number | null
          household_id: string | null
          id: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          current_soc?: number | null
          household_id?: string | null
          id?: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          current_soc?: number | null
          household_id?: string | null
          id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "virtual_chargers_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
