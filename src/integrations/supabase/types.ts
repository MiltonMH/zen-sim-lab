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
      consumption_profiles: {
        Row: {
          created_at: string
          hour: number
          household_id: string
          id: string
          weight: number
        }
        Insert: {
          created_at?: string
          hour: number
          household_id: string
          id?: string
          weight?: number
        }
        Update: {
          created_at?: string
          hour?: number
          household_id?: string
          id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "consumption_profiles_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ev_models: {
        Row: {
          battery_kwh: number
          brand: string
          created_at: string
          id: string
          max_charge_kw: number | null
          max_discharge_kw: number | null
          model: string
          range_km: number | null
          v2x_capable: boolean
        }
        Insert: {
          battery_kwh: number
          brand: string
          created_at?: string
          id?: string
          max_charge_kw?: number | null
          max_discharge_kw?: number | null
          model: string
          range_km?: number | null
          v2x_capable?: boolean
        }
        Update: {
          battery_kwh?: number
          brand?: string
          created_at?: string
          id?: string
          max_charge_kw?: number | null
          max_discharge_kw?: number | null
          model?: string
          range_km?: number | null
          v2x_capable?: boolean
        }
        Relationships: []
      }
      grid_tariff_sources: {
        Row: {
          active: boolean
          api_url: string
          company_name: string
          created_at: string
          id: string
          last_fetched: string | null
          org_number: string | null
          price_area: string | null
        }
        Insert: {
          active?: boolean
          api_url: string
          company_name: string
          created_at?: string
          id?: string
          last_fetched?: string | null
          org_number?: string | null
          price_area?: string | null
        }
        Update: {
          active?: boolean
          api_url?: string
          company_name?: string
          created_at?: string
          id?: string
          last_fetched?: string | null
          org_number?: string | null
          price_area?: string | null
        }
        Relationships: []
      }
      grid_tariffs: {
        Row: {
          fixed_fee_sek_month: number | null
          grid_company: string
          hour_of_day: number
          id: string
          is_weekend: boolean
          month_from: number | null
          month_to: number | null
          peak_fee_sek_kw: number | null
          raw_response: Json | null
          season: string | null
          source_id: string | null
          tariff_sek_kwh: number
          tariff_type: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          fixed_fee_sek_month?: number | null
          grid_company: string
          hour_of_day: number
          id?: string
          is_weekend?: boolean
          month_from?: number | null
          month_to?: number | null
          peak_fee_sek_kw?: number | null
          raw_response?: Json | null
          season?: string | null
          source_id?: string | null
          tariff_sek_kwh: number
          tariff_type?: string | null
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          fixed_fee_sek_month?: number | null
          grid_company?: string
          hour_of_day?: number
          id?: string
          is_weekend?: boolean
          month_from?: number | null
          month_to?: number | null
          peak_fee_sek_kw?: number | null
          raw_response?: Json | null
          season?: string | null
          source_id?: string | null
          tariff_sek_kwh?: number
          tariff_type?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grid_tariffs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "grid_tariff_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      household_profiles: {
        Row: {
          adults: number | null
          annual_kwh: number | null
          area_m2: number | null
          battery_kwh: number | null
          build_year: number | null
          car_model: string | null
          children: number | null
          children_ages: string | null
          commuter_type: string | null
          created_at: string | null
          daily_km: number | null
          ev_model_id: string | null
          grid_company: string | null
          has_solar_panels: boolean | null
          heating_type: string | null
          home_during_day: boolean | null
          house_type: string
          id: string
          insulation_quality: string | null
          leave_time: number | null
          name: string
          price_area: string | null
          return_time: number | null
          routine_type: string | null
          sleep_time: number | null
          solar_kwh_per_year: number | null
          wake_time: number | null
        }
        Insert: {
          adults?: number | null
          annual_kwh?: number | null
          area_m2?: number | null
          battery_kwh?: number | null
          build_year?: number | null
          car_model?: string | null
          children?: number | null
          children_ages?: string | null
          commuter_type?: string | null
          created_at?: string | null
          daily_km?: number | null
          ev_model_id?: string | null
          grid_company?: string | null
          has_solar_panels?: boolean | null
          heating_type?: string | null
          home_during_day?: boolean | null
          house_type?: string
          id?: string
          insulation_quality?: string | null
          leave_time?: number | null
          name: string
          price_area?: string | null
          return_time?: number | null
          routine_type?: string | null
          sleep_time?: number | null
          solar_kwh_per_year?: number | null
          wake_time?: number | null
        }
        Update: {
          adults?: number | null
          annual_kwh?: number | null
          area_m2?: number | null
          battery_kwh?: number | null
          build_year?: number | null
          car_model?: string | null
          children?: number | null
          children_ages?: string | null
          commuter_type?: string | null
          created_at?: string | null
          daily_km?: number | null
          ev_model_id?: string | null
          grid_company?: string | null
          has_solar_panels?: boolean | null
          heating_type?: string | null
          home_during_day?: boolean | null
          house_type?: string
          id?: string
          insulation_quality?: string | null
          leave_time?: number | null
          name?: string
          price_area?: string | null
          return_time?: number | null
          routine_type?: string | null
          sleep_time?: number | null
          solar_kwh_per_year?: number | null
          wake_time?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "household_profiles_ev_model_id_fkey"
            columns: ["ev_model_id"]
            isOneToOne: false
            referencedRelation: "ev_models"
            referencedColumns: ["id"]
          },
        ]
      }
      optimization_logs: {
        Row: {
          charge_kw: number | null
          combined_score: number | null
          decision: string
          energy_tax_sek: number | null
          grid_draw_kw: number | null
          grid_tariff_sek: number | null
          house_consumption_kw: number | null
          household_id: string | null
          id: string
          logged_at: string
          reason: string | null
          soc_pct: number | null
          spot_price_sek: number | null
          total_cost_per_kwh: number | null
          v2h_saving_sek: number | null
        }
        Insert: {
          charge_kw?: number | null
          combined_score?: number | null
          decision: string
          energy_tax_sek?: number | null
          grid_draw_kw?: number | null
          grid_tariff_sek?: number | null
          house_consumption_kw?: number | null
          household_id?: string | null
          id?: string
          logged_at?: string
          reason?: string | null
          soc_pct?: number | null
          spot_price_sek?: number | null
          total_cost_per_kwh?: number | null
          v2h_saving_sek?: number | null
        }
        Update: {
          charge_kw?: number | null
          combined_score?: number | null
          decision?: string
          energy_tax_sek?: number | null
          grid_draw_kw?: number | null
          grid_tariff_sek?: number | null
          house_consumption_kw?: number | null
          household_id?: string | null
          id?: string
          logged_at?: string
          reason?: string | null
          soc_pct?: number | null
          spot_price_sek?: number | null
          total_cost_per_kwh?: number | null
          v2h_saving_sek?: number | null
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
      simulation_events: {
        Row: {
          created_at: string
          event_type: string
          household_id: string | null
          id: string
          metadata: Json | null
          occurred_at: string
          reason: string | null
          simulation_id: string | null
          value_kw: number | null
          value_price_sek: number | null
          value_sek_impact: number | null
          value_soc_pct: number | null
        }
        Insert: {
          created_at?: string
          event_type: string
          household_id?: string | null
          id?: string
          metadata?: Json | null
          occurred_at: string
          reason?: string | null
          simulation_id?: string | null
          value_kw?: number | null
          value_price_sek?: number | null
          value_sek_impact?: number | null
          value_soc_pct?: number | null
        }
        Update: {
          created_at?: string
          event_type?: string
          household_id?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string
          reason?: string | null
          simulation_id?: string | null
          value_kw?: number | null
          value_price_sek?: number | null
          value_sek_impact?: number | null
          value_soc_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "simulation_events_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_events_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulation_runs"
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
          peak_hours_avoided: number | null
          period_from: string
          period_to: string
          price_savings_sek: number | null
          scenario_number: number
          scenario_params: Json | null
          scenarios: number | null
          started_at: string | null
          status: string | null
          total_cost_with_tariff: number | null
          total_events: number
          total_saved_including_tariff: number | null
          total_saved_sek: number | null
          total_v2h_kwh: number | null
          total_v2h_saving_sek: number | null
        }
        Insert: {
          avg_price_paid?: number | null
          ended_at?: string | null
          household_id?: string | null
          id?: string
          optimization_mode: string
          peak_hours_avoided?: number | null
          period_from: string
          period_to: string
          price_savings_sek?: number | null
          scenario_number?: number
          scenario_params?: Json | null
          scenarios?: number | null
          started_at?: string | null
          status?: string | null
          total_cost_with_tariff?: number | null
          total_events?: number
          total_saved_including_tariff?: number | null
          total_saved_sek?: number | null
          total_v2h_kwh?: number | null
          total_v2h_saving_sek?: number | null
        }
        Update: {
          avg_price_paid?: number | null
          ended_at?: string | null
          household_id?: string | null
          id?: string
          optimization_mode?: string
          peak_hours_avoided?: number | null
          period_from?: string
          period_to?: string
          price_savings_sek?: number | null
          scenario_number?: number
          scenario_params?: Json | null
          scenarios?: number | null
          started_at?: string | null
          status?: string | null
          total_cost_with_tariff?: number | null
          total_events?: number
          total_saved_including_tariff?: number | null
          total_saved_sek?: number | null
          total_v2h_kwh?: number | null
          total_v2h_saving_sek?: number | null
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
      spot_prices_days: {
        Args: { _month: number; _year: number }
        Returns: {
          avg_price: number
          day: number
          max_price: number
          min_price: number
          rows: number
        }[]
      }
      spot_prices_months: {
        Args: { _year: number }
        Returns: {
          avg_price: number
          max_price: number
          month: number
          rows: number
        }[]
      }
      spot_prices_years: {
        Args: never
        Returns: {
          avg_price: number
          rows: number
          year: number
        }[]
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
