require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fix() {
  const { data: sessions, error } = await supabase
    .from("day_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);
    
  if (error) {
    console.error(error);
    return;
  }
  
  if (sessions.length > 0) {
    const session = sessions[0];
    console.log("Latest session:", session.id, "Date:", session.business_date);
    
    // Change business date to 2026-07-31
    if (session.business_date === "2026-08-01") {
      const { data: updated, error: updateError } = await supabase
        .from("day_sessions")
        .update({ business_date: "2026-07-31" })
        .eq("id", session.id)
        .select();
        
      if (updateError) {
        console.error("Failed to update:", updateError);
      } else {
        console.log("Updated session:", updated);
      }
      
      // Also update the snapshot if it exists
      await supabase
        .from("day_close_snapshots")
        .update({ business_date: "2026-07-31" })
        .eq("day_session_id", session.id);
        
      await supabase
        .from("day_reopens")
        .update({ business_date: "2026-07-31" })
        .eq("day_session_id", session.id);
    }
  }
}

fix();
