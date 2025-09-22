import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Public, safe to hardcode
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
      return new Response(
        JSON.stringify({
          url_from_env: !!env.SUPABASE_URL,
          using_url: env.SUPABASE_URL || SUPABASE_URL_DEFAULT,
          has_key: !!env.SUPABASE_ANON_KEY
        }, null, 2),
        { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    if (url.pathname !== "/pdf") {
      return new Response("Use /pdf?claim=<id>", { status: 400 });
    }

    const claimId = url.searchParams.get("claim");
    if (!claimId) return new Response("Missing ?claim", { status: 400 });

    const SUPABASE_URL = env.SUPABASE_URL || SUPABASE_URL_DEFAULT;
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
      "diagnosed_by","received_by"
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
    // Up to 3 decimals (trim trailing zeros)
    const fmt3 = (n) => {
      if (n == null || n === "") return "—";
      const num = Number(n);
      if (!Number.isFinite(num)) return "—";
      return num.toFixed(3).replace(/\.?0+$/, "");
    };

// draw up to 3 lines starting from a TOP Y (not baseline)
const drawMultiFromTop = (text, x, topY) => {
  const s = String(text ?? "");
  const charsPerLine = 88;     // fits ~430px @ size 9
  let i = 0, lines = 0, ty = topY - 12;  // first line ~12px below top
  while (i < s.length && lines < 3) {
    drawText(s.slice(i, i + charsPerLine), x, ty, { size: 9 });
    i += charsPerLine; lines++; ty -= 12;
  }
};


    
    // ----- Build PDF -----
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4
    const fontReg = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const drawText = (txt, x, y, { bold=false, size=10 } = {}) =>
      page.drawText(String(txt), { x, y, size, font: bold ? fontBold : fontReg, color: rgb(0,0,0) });

    const box = (x, y, w, h, bw=1) =>
      page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0,0,0), borderWidth: bw });

    // Layout constants
    const MARGIN_L = 30;
    const MARGIN_R = 30;
    const CONTENT_W = 595 - MARGIN_L - MARGIN_R;

    let y = 800;

    // Header
    drawText("KAPS AUTO PARTS", MARGIN_L, y, { bold:true, size:12 });
    drawText(`Claim No.: ${pad(claim.warranty_claim_id)}`, 420, y, { bold:true, size:12 });
    y -= 32;

    // Claim info
    drawText("Date Claimed:", MARGIN_L, y, { bold:true }); drawText(fmtDate(claim.date_claimed), 130, y); y -= 16; y -= 8;
    drawText("Customer:",     MARGIN_L, y, { bold:true }); drawText(pad(claim.account_name), 130, y);  y -= 16; 
    drawText("Address:",      MARGIN_L, y, { bold:true }); drawText(pad(claim.account_address), 130, y); y -= 24;

    // Item info
    drawText("Item Information", MARGIN_L, y, { bold:true, size:11 }); y -= 16;
    drawText("Barcode:", MARGIN_L, y, { bold:true }); drawText(pad(claim.barcode), 130, y); y -= 16;
    drawText("SKU:",     MARGIN_L, y, { bold:true }); drawText(pad(claim.sku_code), 130, y); y -= 20; y -= 8;

    // Diagnostics
    drawText("Diagnostic Report", MARGIN_L, y, { bold:true, size:11 }); y -= 16;

    // A. Testing Before Charging
    drawText("A. Testing Before Charging", MARGIN_L, y, { bold:true }); y -= 14;
    drawText("Open Circuit Voltage:", MARGIN_L, y); drawText(fmt3(claim.voltage_before_charge), 180, y); y -= 14;
    drawText("Electrolyte:", MARGIN_L, y);          drawText(pad(claim.electrolyte), 180, y); y -= 16;

    // 6-cell table helper
    const drawCells = (values, startY) => {
      const cols = 6, cw = 50, chH = 12, chV = 14, gap = 2, x0 = MARGIN_L;
      // header row
      for (let i=0; i<cols; i++) {
        const cx = x0 + i*(cw+gap);
        box(cx, startY - chH, cw, chH);
        drawText(`Cell ${i+1}`, cx + 6, startY - chH + 2, { bold:true, size:8 });
      }
      // value row
      const yVals = startY - chH - chV - 2;
      for (let i=0; i<cols; i++) {
        const cx = x0 + i*(cw+gap);
        box(cx, yVals, cw, chV);
        drawText(fmt3(values[i]), cx + 10, yVals + 2, { size:8 });
      }
      return yVals - 14; // padding
    };

    // Before charge cells
    y = drawCells(
      [claim.cell1_before, claim.cell2_before, claim.cell3_before, claim.cell4_before, claim.cell5_before, claim.cell6_before],
      y
    );
    y -= 8;

    // B. Testing After Charging
    drawText("B. Testing After Charging", MARGIN_L, y, { bold:true }); y -= 14;
    drawText("Open Circuit Voltage:", MARGIN_L, y); drawText(fmt3(claim.voltage_after_charge), 180, y); y -= 16;

    // After charge cells
    y = drawCells(
      [claim.cell1_after, claim.cell2_after, claim.cell3_after, claim.cell4_after, claim.cell5_after, claim.cell6_after],
      y
    );
    y -= 10;

    // C. Assessment / Status
    drawText("C. Assessment / Status", MARGIN_L, y, { bold:true });
    y -= 16;

    drawText("Defective:", MARGIN_L, y, { bold:true });
    drawText(claim.defective ? "Yes" : "No", 150, y);
    drawText("Non-Adjustable:", 280, y, { bold:true });
    drawText(claim.non_adjustable ? "Yes" : "No", 420, y);
    y -= 16;

    drawText("Recharge:", MARGIN_L, y, { bold:true });
    drawText(claim.recharge ? "Yes" : "No", 150, y);
    drawText("No Defect:", 280, y, { bold:true });
    drawText(claim.no_defect ? "Yes" : "No", 420, y);

// modest gap from the Yes/No row
y -= 24;

// alignment constants
const LABEL_X = MARGIN_L;
const BOX_X   = 130;
const BOX_W   = 430;
const BOX_H   = 36;

// how high above the label baseline the TOP of the box should sit
const BOX_TOP_OFFSET = 10;  // tweak 8–12 if you want

const evalRows = [
  ["Result", pad(claim.result)],
  ["Factory Defect", pad(claim.factory_defect)],
  ["Non-Factory Defect", pad(claim.non_factory_defect)],
  ["Remarks", pad(claim.remarks)],
  ["Findings", pad(claim.findings)],
  ["Final Result", pad(claim.final_result)]
];

for (const [label, val] of evalRows) {
  // label baseline
  drawText(label + ":", LABEL_X, y, { bold: true });

  // box top aligned to the top of the word
  const boxTop    = y + BOX_TOP_OFFSET;
  const boxBottom = boxTop - BOX_H;

  box(BOX_X, boxBottom, BOX_W, BOX_H);
  drawMultiFromTop(val, BOX_X + 4, boxTop - 4);

  // step down to next row
  y = boxBottom - 12;
}
y -= 12;  // small extra breathing room before signatures


    // Signatures (equal widths, tall; put value beside the title, no collision)
    const diagName = String(pad(claim.diagnosed_by));
    const recvName = String(pad(claim.received_by));

    const SIG_GAP = 20;
    const SIG_W   = Math.floor((CONTENT_W - SIG_GAP) / 2); // equal width
    const SIG_H   = 36;
    const diagX   = MARGIN_L;
    const recvX   = MARGIN_L + SIG_W + SIG_GAP;

    // Titles
    drawText("Diagnosed By", diagX, y, { bold:true });
    drawText("Received By",  recvX, y, { bold:true });

    // Printed values BESIDE the titles (not colliding)
    // (Place them a bit to the right of each title on the same baseline)
    drawText(diagName, diagX + 110, y);   // shift right so it never hits the title
    drawText(recvName, recvX + 95,  y);

    // Signature boxes (equal length)
    box(diagX, y - 18, SIG_W, SIG_H);
    box(recvX, y - 18, SIG_W, SIG_H);

    const bytes = await pdf.save();
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=warranty_${claimId}.pdf`,
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
