import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://shzmbcyctmuojpwaiagx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoem1iY3ljdG11b2pwd2FpYWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNzM2NDksImV4cCI6MjA5MDY0OTY0OX0.81Pmp1CpKV3LlQlXNL0IibPf0h0DrT5G4MuRhPVnDPk'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
