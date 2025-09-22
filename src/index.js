import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

    if (url.pathname !== "/pdf") {
      return new Response("Use /pdf?claim=<id>", { status: 400 });
    }
    const claimId = url.searchParams.get("claim");
    if (!claimId) return new Response("Missing ?claim", { status: 400 });

    // Fetch data from Supabase view (adjust view name/columns if needed)
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = env;
    const select = [
      "warranty_claim_id","date_claimed",
      "account_name","account_address","account_city","account_province","account_postal_code",
      "sku_code","barcode",
      "voltage_before_charge","cell1_before","cell2_before","cell3_before","cell4_before","cell5_before","cell6_before",
      "voltage_after_charge","cell1_after","cell2_after","cell3_after","cell4_after","cell5_after","cell6_after",
      "electrolyte",
      "defective","non_adjustable","recharge","no_defect",
      "result","factory_defect","non_factory_defect","remarks",
      "findings","final_result"
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
    if (!res.ok) return new Response("Error fetching claim", { status: 500 });
    const rows = await res.json();
    const claim = rows[0];
    if (!claim) return new Response("Claim not found", { status: 404 });

    // Helpers
    const pad = (s) => (s ?? "—");
    const fmtDate = (d) => (d ? d.slice(0,10) : "—");
    const fmtNum = (n) => (n == null ? "—" : Number(n).toFixed(2));

    // Build PDF (matches the layout we finalized)
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4
    const fontReg = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const drawText = (txt, x, y, { bold=false, size=10 }={}) =>
      page.drawText(String(txt), { x, y, size, font: bold ? fontBold : fontReg, color: rgb(0,0,0) });
    const box = (x, y, w, h, bw=1) =>
      page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0,0,0), borderWidth: bw });

    let y = 800;

    // Header
    drawText("KAPS AUTO PARTS", 30, y, { bold:true, size:12 });
    drawText("Sanford Compound Km 22 East Service Road, Muntinlupa City", 30, y-14, { size:10 });
    drawText(`Claim No.: ${pad(claim.warranty_claim_id)}`, 420, y, { bold:true, size:12 });
    y -= 40;

    // Claim info
    drawText("Date Claimed:", 30, y, { bold:true }); drawText(fmtDate(claim.date_claimed), 130, y); y -= 16;
    drawText("Customer:", 30, y, { bold:true });     drawText(pad(claim.account_name), 130, y); y -= 16;
    const addr = [claim.account_address, claim.account_city, claim.account_province, claim.account_postal_code].filter(Boolean).join(", ");
    drawText("Address:", 30, y, { bold:true });      drawText(pad(addr), 130, y); y -= 24;

    // Item info
    drawText("Item Information", 30, y, { bold:true, size:11 }); y -= 16;
    drawText("Barcode:", 30, y, { bold:true }); drawText(pad(claim.barcode), 130, y); y -= 16;
    drawText("SKU:", 30, y, { bold:true });     drawText(pad(claim.sku_code), 130, y); y -= 20;

    // Diagnostics
    drawText("Diagnostic Report", 30, y, { bold:true, size:11 }); y -= 16;

    // A. Testing Before Charging
    drawText("A. Testing Before Charging", 30, y, { bold:true }); y -= 14;
    drawText("Open Circuit Voltage:", 30, y); drawText(fmtNum(claim.voltage_before_charge), 180, y); y -= 14;
    drawText("Electrolyte:", 30, y);          drawText(pad(claim.electrolyte), 180, y); y -= 16;

    // 6-cell table (before)
    const drawCells = (values, startY) => {
      const cols = 6, cw = 50, chH = 12, chV = 14, gap = 2, x0 = 30;
      for (let i=0;i<cols;i++) {
        const cx = x0 + i*(cw+gap);
        box(cx, startY - chH, cw, chH);
        drawText(`Cell ${i+1}`, cx + 6, startY - chH + 2, { bold:true, size:8 });
      }
      const yVals = startY - chH - chV - 2;
      for (let i=0;i<cols;i++) {
        const cx = x0 + i*(cw+gap);
        box(cx, yVals, cw, chV);
        drawText(fmtNum(values[i]), cx + 12, yVals + 2, { size:8 });
      }
      return yVals - 8;
    };
    y = drawCells(
      [claim.cell1_before, claim.cell2_before, claim.cell3_before, claim.cell4_before, claim.cell5_before, claim.cell6_before],
      y
    );

    // B. Testing After Charging
    drawText("B. Testing After Charging", 30, y, { bold:true }); y -= 14;
    drawText("Open Circuit Voltage:", 30, y); drawText(fmtNum(claim.voltage_after_charge), 180, y); y -= 16;
    y = drawCells(
      [claim.cell1_after, claim.cell2_after, claim.cell3_after, claim.cell4_after, claim.cell5_after, claim.cell6_after],
      y
    );

    // C. Assessment / Status (titles left, values centered visually)
    drawText("C. Assessment / Status", 30, y, { bold:true }); y -= 16;
    drawText("Defective:", 30, y, { bold:true });       drawText(claim.defective ? "Yes" : "No", 150, y);
    drawText("Non-Adjustable:", 280, y, { bold:true }); drawText(claim.non_adjustable ? "Yes" : "No", 420, y); y -= 16;
    drawText("Recharge:", 30, y, { bold:true });        drawText(claim.recharge ? "Yes" : "No", 150, y);
    drawText("No Defect:", 280, y, { bold:true });      drawText(claim.no_defect ? "Yes" : "No", 420, y); y -= 20;

    // Combined evaluation block
    const evalRows = [
      ["Result", pad(claim.result)],
      ["Factory Defect", pad(claim.factory_defect)],
      ["Non-Factory Defect", pad(claim.non_factory_defect)],
      ["Remarks", pad(claim.remarks)],
      ["Findings", pad(claim.findings)],
      ["Final Result", pad(claim.final_result)]
    ];
    for (const [label, val] of evalRows) {
      drawText(label + ":", 30, y, { bold:true });
      box(130, y - 3, 430, 32);
      const textMax = 88;
      const chunks = [];
      let i = 0;
      const s = String(val);
      while (i < s.length && chunks.length < 3) {
        chunks.push(s.slice(i, i + textMax));
        i += textMax;
      }
      let ty = y + 14;
      chunks.forEach((c) => { drawText(c, 134, ty, { size:9 }); ty -= 12; });
      y -= 36;
    }

    // Signatures
    drawText("Diagnosed By", 30, y, { bold:true }); box(30, y - 3, 200, 16);
    drawText("Received By", 260, y, { bold:true }); box(260, y - 3, 200, 16);

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
