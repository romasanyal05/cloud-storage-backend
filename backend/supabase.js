const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// ✅ DB operations (insert/select/update/delete)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Token verification (auth.getUser)
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = { supabaseAdmin, supabaseAuth };