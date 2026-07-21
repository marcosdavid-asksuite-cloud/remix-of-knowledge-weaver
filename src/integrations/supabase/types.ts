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
      additional_info: {
        Row: {
          approved_at: string | null
          content: string
          created_at: string
          id: string
          source_chunk_ids: string[]
          status: string
          topic_id: string
        }
        Insert: {
          approved_at?: string | null
          content: string
          created_at?: string
          id?: string
          source_chunk_ids?: string[]
          status?: string
          topic_id: string
        }
        Update: {
          approved_at?: string | null
          content?: string
          created_at?: string
          id?: string
          source_chunk_ids?: string[]
          status?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "additional_info_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      data_point_definitions: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          extraction_examples: Json
          extraction_strategy: string
          field_label: string
          field_name: string
          field_type: string
          id: string
          keywords: Json
          negative_keywords: Json
          regex_pattern: string | null
          required: boolean
          topic_definition_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          extraction_examples?: Json
          extraction_strategy?: string
          field_label: string
          field_name: string
          field_type: string
          id?: string
          keywords?: Json
          negative_keywords?: Json
          regex_pattern?: string | null
          required?: boolean
          topic_definition_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          extraction_examples?: Json
          extraction_strategy?: string
          field_label?: string
          field_name?: string
          field_type?: string
          id?: string
          keywords?: Json
          negative_keywords?: Json
          regex_pattern?: string | null
          required?: boolean
          topic_definition_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_point_definitions_topic_definition_id_fkey"
            columns: ["topic_definition_id"]
            isOneToOne: false
            referencedRelation: "topic_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_snapshots: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          overall_score: number | null
          payload: Json
          project_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          overall_score?: number | null
          payload: Json
          project_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          overall_score?: number | null
          payload?: Json
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      external_agents: {
        Row: {
          active: boolean
          api_key: string | null
          auth_header_name: string | null
          auth_type: string
          context_options: Json
          created_at: string
          custom_headers: Json
          endpoint: string
          id: string
          model: string | null
          name: string
          payload_template: Json | null
          project_id: string | null
          response_path: string | null
          temperature: number | null
          timeout_ms: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          api_key?: string | null
          auth_header_name?: string | null
          auth_type?: string
          context_options?: Json
          created_at?: string
          custom_headers?: Json
          endpoint: string
          id?: string
          model?: string | null
          name: string
          payload_template?: Json | null
          project_id?: string | null
          response_path?: string | null
          temperature?: number | null
          timeout_ms?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          api_key?: string | null
          auth_header_name?: string | null
          auth_type?: string
          context_options?: Json
          created_at?: string
          custom_headers?: Json
          endpoint?: string
          id?: string
          model?: string | null
          name?: string
          payload_template?: Json | null
          project_id?: string | null
          response_path?: string | null
          temperature?: number | null
          timeout_ms?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_agents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_runs: {
        Row: {
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          mode: string
          model_configuration_id: string | null
          preview_result: Json | null
          project_id: string
          prompt_template_id: string | null
          raw_source_ids: string[]
          started_at: string | null
          stats: Json
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          mode: string
          model_configuration_id?: string | null
          preview_result?: Json | null
          project_id: string
          prompt_template_id?: string | null
          raw_source_ids?: string[]
          started_at?: string | null
          stats?: Json
          status?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          model_configuration_id?: string | null
          preview_result?: Json | null
          project_id?: string
          prompt_template_id?: string | null
          raw_source_ids?: string[]
          started_at?: string | null
          stats?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_runs_model_configuration_id_fkey"
            columns: ["model_configuration_id"]
            isOneToOne: false
            referencedRelation: "model_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_runs_prompt_template_id_fkey"
            columns: ["prompt_template_id"]
            isOneToOne: false
            referencedRelation: "prompt_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_settings: {
        Row: {
          chunk_size: number
          extraction_prompt: string
          id: string
          max_chunks: number
          singleton: boolean
          system_prompt: string
          temperature: number
          unified_prompt: string | null
          updated_at: string
          use_llm_for_dynamic: boolean
        }
        Insert: {
          chunk_size?: number
          extraction_prompt: string
          id?: string
          max_chunks?: number
          singleton?: boolean
          system_prompt: string
          temperature?: number
          unified_prompt?: string | null
          updated_at?: string
          use_llm_for_dynamic?: boolean
        }
        Update: {
          chunk_size?: number
          extraction_prompt?: string
          id?: string
          max_chunks?: number
          singleton?: boolean
          system_prompt?: string
          temperature?: number
          unified_prompt?: string | null
          updated_at?: string
          use_llm_for_dynamic?: boolean
        }
        Relationships: []
      }
      knowledge_candidates: {
        Row: {
          confidence: number | null
          created_at: string
          extraction_method: string
          extraction_run_id: string | null
          field_name: string
          field_origin: string
          field_type: string
          field_value: Json | null
          id: string
          project_id: string
          source_chunk_ids: string[]
          status: string
          topic_definition_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          extraction_method?: string
          extraction_run_id?: string | null
          field_name: string
          field_origin: string
          field_type: string
          field_value?: Json | null
          id?: string
          project_id: string
          source_chunk_ids?: string[]
          status?: string
          topic_definition_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          extraction_method?: string
          extraction_run_id?: string | null
          field_name?: string
          field_origin?: string
          field_type?: string
          field_value?: Json | null
          id?: string
          project_id?: string
          source_chunk_ids?: string[]
          status?: string
          topic_definition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_candidates_extraction_run_id_fkey"
            columns: ["extraction_run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_candidates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_candidates_topic_definition_id_fkey"
            columns: ["topic_definition_id"]
            isOneToOne: false
            referencedRelation: "topic_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_conflicts: {
        Row: {
          candidate_ids: string[]
          conflict_type: string
          created_at: string
          field_name: string
          field_type: string
          id: string
          manual_value: Json | null
          project_id: string
          resolution_note: string | null
          resolved_at: string | null
          selected_candidate_id: string | null
          status: string
          topic_definition_id: string
        }
        Insert: {
          candidate_ids?: string[]
          conflict_type?: string
          created_at?: string
          field_name: string
          field_type: string
          id?: string
          manual_value?: Json | null
          project_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          selected_candidate_id?: string | null
          status?: string
          topic_definition_id: string
        }
        Update: {
          candidate_ids?: string[]
          conflict_type?: string
          created_at?: string
          field_name?: string
          field_type?: string
          id?: string
          manual_value?: Json | null
          project_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          selected_candidate_id?: string | null
          status?: string
          topic_definition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_conflicts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_conflicts_selected_candidate_id_fkey"
            columns: ["selected_candidate_id"]
            isOneToOne: false
            referencedRelation: "knowledge_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_conflicts_topic_definition_id_fkey"
            columns: ["topic_definition_id"]
            isOneToOne: false
            referencedRelation: "topic_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_fields: {
        Row: {
          approved_at: string | null
          approved_by_user: boolean
          candidate_ids: string[]
          confidence: number | null
          consolidation_status: string
          created_at: string
          field_name: string
          field_origin: string
          field_type: string
          field_value: Json | null
          id: string
          source_chunk_ids: string[]
          source_of_truth: string
          topic_id: string
          verified: boolean
        }
        Insert: {
          approved_at?: string | null
          approved_by_user?: boolean
          candidate_ids?: string[]
          confidence?: number | null
          consolidation_status?: string
          created_at?: string
          field_name: string
          field_origin: string
          field_type: string
          field_value?: Json | null
          id?: string
          source_chunk_ids?: string[]
          source_of_truth?: string
          topic_id: string
          verified?: boolean
        }
        Update: {
          approved_at?: string | null
          approved_by_user?: boolean
          candidate_ids?: string[]
          confidence?: number | null
          consolidation_status?: string
          created_at?: string
          field_name?: string
          field_origin?: string
          field_type?: string
          field_value?: Json | null
          id?: string
          source_chunk_ids?: string[]
          source_of_truth?: string
          topic_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_fields_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_health_snapshots: {
        Row: {
          additional_info_count: number
          approved_ratio: number
          confidence_score: number
          core_coverage: number
          created_at: string
          dynamic_ratio: number
          flags: Json
          health_score: number
          id: string
          missing_optional_fields: Json
          missing_required_fields: Json
          pending_additional_info_count: number
          pending_candidates_count: number
          pending_conflicts_count: number
          project_id: string
          required_coverage: number
          topic_definition_id: string
        }
        Insert: {
          additional_info_count?: number
          approved_ratio?: number
          confidence_score?: number
          core_coverage?: number
          created_at?: string
          dynamic_ratio?: number
          flags?: Json
          health_score?: number
          id?: string
          missing_optional_fields?: Json
          missing_required_fields?: Json
          pending_additional_info_count?: number
          pending_candidates_count?: number
          pending_conflicts_count?: number
          project_id: string
          required_coverage?: number
          topic_definition_id: string
        }
        Update: {
          additional_info_count?: number
          approved_ratio?: number
          confidence_score?: number
          core_coverage?: number
          created_at?: string
          dynamic_ratio?: number
          flags?: Json
          health_score?: number
          id?: string
          missing_optional_fields?: Json
          missing_required_fields?: Json
          pending_additional_info_count?: number
          pending_candidates_count?: number
          pending_conflicts_count?: number
          project_id?: string
          required_coverage?: number
          topic_definition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_health_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_health_snapshots_topic_definition_id_fkey"
            columns: ["topic_definition_id"]
            isOneToOne: false
            referencedRelation: "topic_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_settings: {
        Row: {
          created_at: string
          id: string
          project_id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_calls: {
        Row: {
          created_at: string
          estimated_cost: number | null
          extraction_run_id: string | null
          id: string
          input_tokens: number | null
          latency: number | null
          model_name: string
          output_tokens: number | null
          prompt_type: string
          response: Json | null
          test_run_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost?: number | null
          extraction_run_id?: string | null
          id?: string
          input_tokens?: number | null
          latency?: number | null
          model_name: string
          output_tokens?: number | null
          prompt_type: string
          response?: Json | null
          test_run_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost?: number | null
          extraction_run_id?: string | null
          id?: string
          input_tokens?: number | null
          latency?: number | null
          model_name?: string
          output_tokens?: number | null
          prompt_type?: string
          response?: Json | null
          test_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "llm_calls_extraction_run_id_fkey"
            columns: ["extraction_run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      model_configurations: {
        Row: {
          active: boolean
          api_key: string | null
          created_at: string
          id: string
          max_tokens: number
          model_name: string
          provider: string
          temperature: number
        }
        Insert: {
          active?: boolean
          api_key?: string | null
          created_at?: string
          id?: string
          max_tokens?: number
          model_name: string
          provider: string
          temperature?: number
        }
        Update: {
          active?: boolean
          api_key?: string | null
          created_at?: string
          id?: string
          max_tokens?: number
          model_name?: string
          provider?: string
          temperature?: number
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      prompt_templates: {
        Row: {
          content: string
          created_at: string
          id: string
          name: string
          type: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          name: string
          type: string
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          name?: string
          type?: string
          version?: number
        }
        Relationships: []
      }
      raw_chunks: {
        Row: {
          content: string
          created_at: string
          extraction_status: string
          id: string
          metadata: Json
          position: number
          raw_source_id: string
        }
        Insert: {
          content: string
          created_at?: string
          extraction_status?: string
          id?: string
          metadata?: Json
          position?: number
          raw_source_id: string
        }
        Update: {
          content?: string
          created_at?: string
          extraction_status?: string
          id?: string
          metadata?: Json
          position?: number
          raw_source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_chunks_raw_source_id_fkey"
            columns: ["raw_source_id"]
            isOneToOne: false
            referencedRelation: "raw_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_sources: {
        Row: {
          filename: string | null
          id: string
          project_id: string
          type: string
          uploaded_at: string
        }
        Insert: {
          filename?: string | null
          id?: string
          project_id: string
          type: string
          uploaded_at?: string
        }
        Update: {
          filename?: string | null
          id?: string
          project_id?: string
          type?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      suggested_data_points: {
        Row: {
          avg_confidence: number
          consolidated_count: number
          created_at: string
          examples: Json
          id: string
          occurrences: number
          projects_count: number
          resulting_data_point_id: string | null
          status: string
          suggested_field_name: string
          suggested_label: string
          suggested_type: string
          suggestion_score: number
          topic_definition_id: string | null
          topic_slug: string
          updated_at: string
        }
        Insert: {
          avg_confidence?: number
          consolidated_count?: number
          created_at?: string
          examples?: Json
          id?: string
          occurrences?: number
          projects_count?: number
          resulting_data_point_id?: string | null
          status?: string
          suggested_field_name: string
          suggested_label: string
          suggested_type?: string
          suggestion_score?: number
          topic_definition_id?: string | null
          topic_slug: string
          updated_at?: string
        }
        Update: {
          avg_confidence?: number
          consolidated_count?: number
          created_at?: string
          examples?: Json
          id?: string
          occurrences?: number
          projects_count?: number
          resulting_data_point_id?: string | null
          status?: string
          suggested_field_name?: string
          suggested_label?: string
          suggested_type?: string
          suggestion_score?: number
          topic_definition_id?: string | null
          topic_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggested_data_points_resulting_data_point_id_fkey"
            columns: ["resulting_data_point_id"]
            isOneToOne: false
            referencedRelation: "data_point_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggested_data_points_topic_definition_id_fkey"
            columns: ["topic_definition_id"]
            isOneToOne: false
            referencedRelation: "topic_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      test_batches: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          model_name: string | null
          modes: string[]
          name: string
          options: Json
          project_id: string
          question_count: number
          started_at: string
          statistics: Json
          status: string
          temperature: number | null
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          model_name?: string | null
          modes?: string[]
          name: string
          options?: Json
          project_id: string
          question_count?: number
          started_at?: string
          statistics?: Json
          status?: string
          temperature?: number | null
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          model_name?: string | null
          modes?: string[]
          name?: string
          options?: Json
          project_id?: string
          question_count?: number
          started_at?: string
          statistics?: Json
          status?: string
          temperature?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "test_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      test_evaluations: {
        Row: {
          completeness_score: number | null
          created_at: string
          evaluator: string
          hallucination_score: number | null
          id: string
          latency_score: number | null
          notes: string | null
          precision_score: number | null
          test_run_id: string
          usefulness_score: number | null
        }
        Insert: {
          completeness_score?: number | null
          created_at?: string
          evaluator?: string
          hallucination_score?: number | null
          id?: string
          latency_score?: number | null
          notes?: string | null
          precision_score?: number | null
          test_run_id: string
          usefulness_score?: number | null
        }
        Update: {
          completeness_score?: number | null
          created_at?: string
          evaluator?: string
          hallucination_score?: number | null
          id?: string
          latency_score?: number | null
          notes?: string | null
          precision_score?: number | null
          test_run_id?: string
          usefulness_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "test_evaluations_test_run_id_fkey"
            columns: ["test_run_id"]
            isOneToOne: false
            referencedRelation: "test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      test_questions: {
        Row: {
          active: boolean
          created_at: string
          expected_answer: string | null
          expected_facts: Json
          id: string
          project_id: string
          question: string
          topic_definition_ids: string[]
        }
        Insert: {
          active?: boolean
          created_at?: string
          expected_answer?: string | null
          expected_facts?: Json
          id?: string
          project_id: string
          question: string
          topic_definition_ids?: string[]
        }
        Update: {
          active?: boolean
          created_at?: string
          expected_answer?: string | null
          expected_facts?: Json
          id?: string
          project_id?: string
          question?: string
          topic_definition_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "test_questions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      test_runs: {
        Row: {
          answer: string | null
          context_sent: Json | null
          created_at: string
          error_message: string | null
          estimated_cost: number | null
          external_agent_id: string | null
          human_notes: string | null
          human_score: number | null
          id: string
          input_tokens: number | null
          latency_ms: number | null
          llm_call_id: string | null
          mode: string
          model_configuration_id: string | null
          model_name: string | null
          output_tokens: number | null
          project_id: string | null
          prompt_template_id: string | null
          question_id: string
          request_payload: Json | null
          status: string
          test_batch_id: string | null
        }
        Insert: {
          answer?: string | null
          context_sent?: Json | null
          created_at?: string
          error_message?: string | null
          estimated_cost?: number | null
          external_agent_id?: string | null
          human_notes?: string | null
          human_score?: number | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          llm_call_id?: string | null
          mode: string
          model_configuration_id?: string | null
          model_name?: string | null
          output_tokens?: number | null
          project_id?: string | null
          prompt_template_id?: string | null
          question_id: string
          request_payload?: Json | null
          status?: string
          test_batch_id?: string | null
        }
        Update: {
          answer?: string | null
          context_sent?: Json | null
          created_at?: string
          error_message?: string | null
          estimated_cost?: number | null
          external_agent_id?: string | null
          human_notes?: string | null
          human_score?: number | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          llm_call_id?: string | null
          mode?: string
          model_configuration_id?: string | null
          model_name?: string | null
          output_tokens?: number | null
          project_id?: string | null
          prompt_template_id?: string | null
          question_id?: string
          request_payload?: Json | null
          status?: string
          test_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "test_runs_external_agent_id_fkey"
            columns: ["external_agent_id"]
            isOneToOne: false
            referencedRelation: "external_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_runs_llm_call_id_fkey"
            columns: ["llm_call_id"]
            isOneToOne: false
            referencedRelation: "llm_calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_runs_model_configuration_id_fkey"
            columns: ["model_configuration_id"]
            isOneToOne: false
            referencedRelation: "model_configurations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_runs_prompt_template_id_fkey"
            columns: ["prompt_template_id"]
            isOneToOne: false
            referencedRelation: "prompt_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_runs_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "test_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_runs_test_batch_id_fkey"
            columns: ["test_batch_id"]
            isOneToOne: false
            referencedRelation: "test_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_definitions: {
        Row: {
          aliases: string[]
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          description?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      topics: {
        Row: {
          created_at: string
          id: string
          project_id: string
          topic_definition_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          topic_definition_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          topic_definition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_topic_definition_id_fkey"
            columns: ["topic_definition_id"]
            isOneToOne: false
            referencedRelation: "topic_definitions"
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
