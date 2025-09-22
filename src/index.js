// src/index.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Safe to hardcode (not a secret)
const SUPABASE_URL_DEFAULT = "https://idtwjchmeldqwurigvkx.supabase.co";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type"
        }
      });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        url_from_env: !!env.SUPABASE_URL,
        using_url: env.SUPABASE_URL || SUPABASE_URL_DEFAULT,
        has_key: !!env.SUPABASE_ANON_KEY
      }, null, 2), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (url.pathname !== "/pdf") {
      return new Response("Use /pdf?claim=<id>", { status: 400 });
    }

    const claimId = url.searchParams.get("claim");
    if (!claimId) return new Response("Missing ?claim", { status: 400 });

    const SUPABASE_URL = env.SUPABASE_URL || SUPABASE_URL_DEFAULT; // fallback
    const { SUPABASE_ANON_KEY } = env;

    if (!SUPABASE_ANON_KEY) {
      return new Response("Missing env: SUPABASE_ANON_KEY", { status: 500 });
    }

    // ----- Fetch from Supabase view -----
    const select = [
      "warranty_claim_id","date_claimed",
      "account_name","account_address",
      "sku_code","barcode","batch_no",
      "voltage_before_charge","cell1_before","cell2_before","cell3_before","cell4_before","cell5_before","cell6_before",
      "voltage_after_charge","cell1_after","cell2_after","cell3_after","cell4_after","cell5_after","cell6_after",
      "electrolyte",
      "defective","non_adjustable","recharge","no_defect",
      "result","factory_defect","non_factory_defect","remarks","findings","final_result",
      "diagnosed_by","diagnosed_by_name","received_by"
    ].join(",");

    const supabaseUrl =
      `${SUPABASE_URL}/rest/v1/warranty_claims_pdf_v?` +
      `select=${encodeURIComponent(select)}&` +
      `warranty_claim_id=eq.${encodeURIComponent(claimId)}&limit=1`;

    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    };

    const res = await fetch(supabaseUrl, { headers });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return new Response(`Error fetching claim (${res.status}): ${txt}`, { status: 500 });
    }
    const rows = await res.json();
    const claim = rows[0];
    if (!claim) return new Response("Claim not found", { status: 404 });

    // ----- Helpers -----
    const pad = (s) => (s ?? "—");
    const fmtDate = (d) => (d ? d.slice(0,10) : "—");
    // up to 3 decimals (no trailing zeros)
    const fmt3 = (n) => {
      if (n == null || n === "") return "—";
      const num = Number(n);
      if (!Number.isFinite(num)) return "—";
      return num.toFixed(3).replace(/\.?0+$/, "");
    };

    // ----- Build PDF -----
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4
    const fontReg = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBol
