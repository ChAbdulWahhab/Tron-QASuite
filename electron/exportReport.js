const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { app } = require('electron');
const docx = require('docx');

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
  AlignmentType,
  BorderStyle,
  ShadingType,
  VerticalAlign
} = docx;

const PAGE_W = 595;
const PAGE_H = 842;
const MARGINS = { top: 50, bottom: 50, left: 50, right: 50 };
const CONTENT_W = PAGE_W - MARGINS.left - MARGINS.right;

const COL_NUM = 20;
const COL_NAME = 150;
const COL_CAT = 80;
const COL_STAT = 55;
const COL_TIME = 45;
const COL_DET = 145;
const ROW_H_MIN = 18;
const TABLE_HEADER_H = 18;
const DETAIL_MAX_CHARS = 3500;

function normalizeReport(report) {
  const tests = (report.tests || []).map((t) => ({
    name: String(t.name ?? ''),
    displayName: String(t.display_name || t.displayName || (t.name ?? '')),
    category: String(t.category ?? '—'),
    status: String(t.status ?? ''),
    duration: typeof t.duration === 'number' ? t.duration : Number(t.duration) || 0,
    message: String(t.message ?? '')
  }));
  return {
    url: String(report.url ?? ''),
    runDate: (() => {
      const rd = report.runDate;
      if (rd == null || rd === '') return new Date().toISOString();
      const d = new Date(rd);
      return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    })(),
    modeLabel: report.modeLabel || (report.headless === false ? 'Browser' : 'Headless'),
    score: Number(report.score) || 0,
    totalTests: Number(report.totalTests) || tests.length,
    passed: Number(report.passed) || 0,
    failed: Number(report.failed) || 0,
    warned: Number(report.warned) || 0,
    durationSeconds: Number(report.durationSeconds) || 0,
    tests
  };
}

function resolvePdfLogoPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tron-app.png');
  }
  return path.join(__dirname, '../src/assets/tron-app.png');
}

/** Match renderer `toUtcInstantString` — SQLite UTC without Z. */
function toUtcInstantStringExport(iso) {
  if (iso == null || iso === '') return null;
  const s = String(iso).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && (/Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s))) {
    return s;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?$/);
  if (m) return `${m[1]}T${m[2]}${m[3] || ''}Z`;
  return s;
}

/** Local wall-clock time in English (testers’ machine timezone). */
function formatReportDate(iso) {
  const normalized = toUtcInstantStringExport(iso);
  const d =
    normalized != null && normalized !== ''
      ? new Date(normalized)
      : iso != null && iso !== ''
        ? new Date(iso)
        : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    });
  }
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });
}

/** Short, readable summary for exports (avoid full Python tracebacks in PDF/DOCX). */
function testerFacingDetail(message, status) {
  const st = String(status || '').toUpperCase();
  let raw = String(message ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!raw) return '—';
  if (st === 'PASSED' && /^passed$/i.test(raw)) return '—';

  const failM = raw.match(/FAIL:[^\n]*/i);
  if (failM) return failM[0].trim().slice(0, 720);

  const skipM = raw.match(/Skipped:\s*[^\n]*/i);
  if (skipM) return skipM[0].trim().replace(/\s+/g, ' ').slice(0, 520);

  const pytestFail = raw.match(/E\s+AssertionError:\s*[^\n]+/i);
  if (pytestFail) return pytestFail[0].replace(/^E\s+/i, '').trim().slice(0, 520);

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const noPaths = lines.filter((l) => !/\.py['"]?:\d+/i.test(l) && !/^File\s+"/i.test(l));
  const pick = noPaths.length ? noPaths : lines;
  if (pick.length >= 1) {
    const tail = pick.slice(-2).join(' · ');
    if (tail.length <= 900) return tail;
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, 720);
}

/** Single-line for narrow columns; details column uses full wrap separately. */
function sanitizeDetailMessage(message, status) {
  const friendly = testerFacingDetail(message, status);
  let m = friendly;
  if (m === '—') return m;
  if (m.length > DETAIL_MAX_CHARS) {
    m = `${m.slice(0, DETAIL_MAX_CHARS)}…`;
  }
  return m;
}

function detailParagraphsForDocx(message, status) {
  let m = testerFacingDetail(message, status);
  if (m === '—') {
    return [new Paragraph({ children: [new TextRun({ text: '—', size: 16, font: 'Calibri', color: '888888' })] })];
  }
  if (m.length > DETAIL_MAX_CHARS) {
    m = `${m.slice(0, DETAIL_MAX_CHARS)}…`;
  }
  const chunks = m.split(/\n/).flatMap((line) => {
    const parts = [];
    const max = 120;
    let rest = line;
    while (rest.length > max) {
      parts.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    parts.push(rest);
    return parts;
  });
  return chunks.slice(0, 80).map(
    (line) =>
      new Paragraph({
        spacing: { after: 40, before: 0 },
        children: [new TextRun({ text: line || ' ', size: 16, font: 'Calibri' })]
      })
  );
}

function statusColor(status) {
  if (status === 'PASSED') return '#16A34A';
  if (status === 'FAILED') return '#DC2626';
  return '#D97706';
}

function exportToPDF(report, outputPath) {
  const r = normalizeReport(report);
  const generatedAtIso = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margins: MARGINS,
      bufferPages: true,
      info: { Title: 'TRON QA Report', Author: 'TRON QA Suite' }
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => {
      try {
        fs.writeFileSync(outputPath, Buffer.concat(chunks));
        resolve(outputPath);
      } catch (e) {
        reject(e);
      }
    });

    doc.on('pageAdded', () => {
      /* page index tracked internally by PDFKit for bufferPages */
    });

    const left = MARGINS.left;
    const right = PAGE_W - MARGINS.right;
    const logoPath = resolvePdfLogoPath();

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, left, MARGINS.top, { width: 40, height: 40 });
    }

    doc
      .fontSize(13)
      .font('Helvetica-Bold')
      .fillColor('#199998')
      .text('TRON QA Suite — Automated Report', left, MARGINS.top + 8, {
        width: CONTENT_W,
        align: 'right'
      });

    doc.y = MARGINS.top + 48;
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#E2E2DE').lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    doc.fontSize(10).font('Helvetica').fillColor('#1C1C1A');
    doc.text(`Target URL: ${r.url}`, { width: CONTENT_W });
    doc.moveDown(0.35);
    doc.text(`Test run completed: ${formatReportDate(r.runDate)}`, { width: CONTENT_W });
    doc.moveDown(0.35);
    doc.text(`Report exported: ${formatReportDate(generatedAtIso)}`, { width: CONTENT_W });
    doc.moveDown(0.35);
    doc.text(`Mode:       ${r.modeLabel}`, { width: CONTENT_W });
    doc.moveDown(0.35);
    doc.text(`Duration:   ${r.durationSeconds.toFixed(1)}s`, { width: CONTENT_W });
    doc.moveDown(0.35);
    doc
      .font('Helvetica-Bold')
      .text(
        `Score:      ${r.score}%  |  PASSED: ${r.passed}  |  FAILED: ${r.failed}  |  WARNED: ${r.warned}`,
        { width: CONTENT_W }
      );
    doc.font('Helvetica');
    doc.moveDown(0.6);

    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#E2E2DE').lineWidth(0.5).stroke();
    doc.moveDown(0.75);

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1C1C1A').text('TEST RESULTS', { width: CONTENT_W });
    doc.moveDown(0.25);
    doc.fontSize(7).fillColor('#6b7280').font('Helvetica');
    doc.text(
      'Details: short summaries for failures and warnings. Open the TRON app for full log output.',
      left,
      doc.y,
      { width: CONTENT_W, align: 'left' }
    );
    doc.moveDown(0.45);

    function bottomReserve() {
      return doc.page.height - MARGINS.bottom - 80;
    }

    function drawTableHeader() {
      if (doc.y > bottomReserve()) {
        doc.addPage();
      }
      const y0 = doc.y;
      doc.save();
      doc.rect(left, y0, CONTENT_W, TABLE_HEADER_H).fill('#F4F8FF');
      doc.restore();
      doc.fillColor('#199998').font('Helvetica-Bold').fontSize(9);
      let cx = left + 3;
      doc.text('#', cx, y0 + 5, { width: COL_NUM - 4, lineBreak: false });
      cx += COL_NUM;
      doc.text('Test Name', cx, y0 + 5, { width: COL_NAME - 4, lineBreak: false });
      cx += COL_NAME;
      doc.text('Category', cx, y0 + 5, { width: COL_CAT - 4, lineBreak: false });
      cx += COL_CAT;
      doc.text('Status', cx, y0 + 5, { width: COL_STAT - 4, lineBreak: false });
      cx += COL_STAT;
      doc.text('Time', cx, y0 + 5, { width: COL_TIME - 4, lineBreak: false });
      cx += COL_TIME;
      doc.text('Details', cx, y0 + 5, { width: COL_DET - 6, lineBreak: false });
      doc.y = y0 + TABLE_HEADER_H;
    }

    drawTableHeader();

    doc.font('Helvetica').fontSize(8).fillColor('#1C1C1A');

    const lineGap = 1.5;
    const padY = 6;
    const wNum = COL_NUM - 4;
    const wName = COL_NAME - 4;
    const wCat = COL_CAT - 4;
    const wStat = COL_STAT - 4;
    const wTime = COL_TIME - 4;
    const wDet = COL_DET - 8;

    r.tests.forEach((t, i) => {
      const label = String(t.displayName || t.name);
      const msg = sanitizeDetailMessage(t.message, t.status);
      const cat = String(t.category || '—');
      const timeStr = `${t.duration.toFixed(2)}s`;

      doc.font('Helvetica').fontSize(8).fillColor('#1C1C1A');
      const hNum = doc.heightOfString(String(i + 1), { width: wNum, lineGap });
      const hName = doc.heightOfString(label, { width: wName, lineGap });
      const hCat = doc.heightOfString(cat, { width: wCat, lineGap });
      doc.font('Helvetica-Bold');
      const hStat = doc.heightOfString(t.status, { width: wStat, lineGap });
      doc.font('Helvetica');
      const hTime = doc.heightOfString(timeStr, { width: wTime, lineGap });
      const hDet = doc.heightOfString(msg, { width: wDet, lineGap });

      const rowH = Math.ceil(Math.max(ROW_H_MIN, hNum, hName, hCat, hStat, hTime, hDet) + padY);

      if (doc.y + rowH > bottomReserve()) {
        doc.addPage();
        drawTableHeader();
        doc.font('Helvetica').fontSize(8).fillColor('#1C1C1A');
      }

      const y0 = doc.y;
      if (i % 2 === 1) {
        doc.save();
        doc.rect(left, y0, CONTENT_W, rowH).fill('#f3f4f6');
        doc.restore();
      }

      let cx = left + 3;
      doc.fillColor('#1C1C1A').font('Helvetica').text(String(i + 1), cx, y0 + 4, {
        width: wNum,
        lineGap
      });
      cx += COL_NUM;
      doc.text(label, cx, y0 + 4, { width: wName, lineGap });
      cx += COL_NAME;
      doc.text(cat, cx, y0 + 4, { width: wCat, lineGap });
      cx += COL_CAT;
      doc
        .fillColor(statusColor(t.status))
        .font('Helvetica-Bold')
        .text(t.status, cx, y0 + 4, { width: wStat, lineGap });
      cx += COL_STAT;
      doc.fillColor('#1C1C1A').font('Helvetica').text(timeStr, cx, y0 + 4, { width: wTime, lineGap });
      cx += COL_TIME;
      doc.text(msg, cx, y0 + 4, { width: wDet, lineGap });

      doc.y = y0 + rowH;
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#e5e7eb').lineWidth(0.35).stroke();
    });

    if (doc.y > doc.page.height - MARGINS.bottom - 100) {
      doc.addPage();
    }

    doc.moveDown(0.75);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#CCCCCC').lineWidth(0.35).stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('#555555').font('Helvetica');
    const footerBlock = [
      'TRON QA Suite v3 — automated quality verification report',
      'Website: https://tronq.vercel.app   ·   Systemset Co.',
      `Report file generated: ${formatReportDate(generatedAtIso)}`,
      'Contact: ch.abdul.wahhab@proton.me'
    ].join('\n');
    doc.text(footerBlock, left, doc.y, {
      width: CONTENT_W,
      align: 'left',
      lineGap: 2
    });

    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let pi = 0; pi < total; pi++) {
      doc.switchToPage(range.start + pi);
      const baseY = PAGE_H - MARGINS.bottom - 18;
      doc.fontSize(8).fillColor('#888888').font('Helvetica');
      doc.text(`Page ${pi + 1} of ${total}`, left, baseY, {
        width: CONTENT_W,
        align: 'center'
      });
    }

    doc.end();
  });
}

const BORDER_CELL = {
  top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E2DE' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E2DE' },
  left: { style: BorderStyle.SINGLE, size: 1, color: 'E2E2DE' },
  right: { style: BorderStyle.SINGLE, size: 1, color: 'E2E2DE' }
};

const COL_TWIPS = [400, 2800, 1500, 1000, 800, 2700];

function cellPara(children, opts = {}) {
  return new Paragraph({
    alignment: opts.alignment,
    spacing: { after: 40, before: 0 },
    children
  });
}

function exportToDocx(report, outputPath, logoPath) {
  const r = normalizeReport(report);
  const exportedAtIso = new Date().toISOString();
  const marginTwip = 720;
  const resolvedLogo =
    logoPath && fs.existsSync(logoPath) ? logoPath : resolvePdfLogoPath();

  const children = [];

  if (resolvedLogo && fs.existsSync(resolvedLogo)) {
    const buf = fs.readFileSync(resolvedLogo);
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: buf,
            transformation: { width: 72, height: 72 }
          })
        ],
        spacing: { after: 160 }
      })
    );
  }

  children.push(
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'TRON QA Suite — Automated Report',
          bold: true,
          size: 28,
          color: '199998',
          font: 'Calibri'
        })
      ]
    })
  );

  const metaLines = [
    `Target URL: ${r.url}`,
    `Test run completed: ${formatReportDate(r.runDate)}`,
    `Report exported: ${formatReportDate(exportedAtIso)}`,
    `Mode:       ${r.modeLabel}`,
    `Duration:   ${r.durationSeconds.toFixed(1)}s`,
    `Score:      ${r.score}%  |  PASSED: ${r.passed}  |  FAILED: ${r.failed}  |  WARNED: ${r.warned}`
  ];
  for (const line of metaLines) {
    children.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: line, font: 'Calibri', size: 20 })]
      })
    );
  }

  children.push(new Paragraph({ text: '', spacing: { after: 160 } }));

  const headerCells = ['#', 'Test Name', 'Category', 'Status', 'Time', 'Details'].map(
    (h, idx) =>
      new TableCell({
        width: { size: COL_TWIPS[idx], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: { fill: 'F4F8FF', type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        borders: BORDER_CELL,
        children: [
          cellPara([
            new TextRun({
              text: h,
              bold: true,
              size: 18,
              color: '199998',
              font: 'Calibri'
            })
          ])
        ]
      })
  );

  const headerRow = new TableRow({ tableHeader: true, children: headerCells });

  const dataRows = r.tests.map((t, idx) => {
    const isPass = t.status === 'PASSED';
    const isFail = t.status === 'FAILED';
    const statusColor = isPass ? '16A34A' : isFail ? 'DC2626' : 'D97706';
    const detailChildren = detailParagraphsForDocx(t.message, t.status);
    const cells = [
      new TableCell({
        width: { size: COL_TWIPS[0], type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        borders: BORDER_CELL,
        children: [cellPara([new TextRun({ text: String(idx + 1), size: 16, font: 'Calibri' })])]
      }),
      new TableCell({
        width: { size: COL_TWIPS[1], type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        borders: BORDER_CELL,
        children: [
          cellPara([
            new TextRun({ text: String(t.displayName || t.name), size: 16, font: 'Calibri' })
          ])
        ]
      }),
      new TableCell({
        width: { size: COL_TWIPS[2], type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        borders: BORDER_CELL,
        children: [cellPara([new TextRun({ text: t.category, size: 16, font: 'Calibri' })])]
      }),
      new TableCell({
        width: { size: COL_TWIPS[3], type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        borders: BORDER_CELL,
        children: [
          cellPara([
            new TextRun({
              text: t.status,
              bold: true,
              size: 16,
              color: statusColor,
              font: 'Calibri'
            })
          ])
        ]
      }),
      new TableCell({
        width: { size: COL_TWIPS[4], type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        borders: BORDER_CELL,
        children: [
          cellPara([
            new TextRun({ text: `${t.duration.toFixed(2)}s`, size: 16, font: 'Calibri' })
          ])
        ]
      }),
      new TableCell({
        width: { size: COL_TWIPS[5], type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        borders: BORDER_CELL,
        children: detailChildren
      })
    ];
    return new TableRow({ children: cells });
  });

  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'TEST RESULTS', bold: true, size: 22, font: 'Calibri' })],
      spacing: { before: 120, after: 80 }
    })
  );
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: 'Details: short summaries for failures and warnings. Use the TRON app for full logs.',
          italics: true,
          size: 18,
          color: '718096',
          font: 'Calibri'
        })
      ]
    })
  );

  children.push(
    new Table({
      width: { size: 9200, type: WidthType.DXA },
      columnWidths: COL_TWIPS,
      rows: [headerRow, ...dataRows]
    })
  );

  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 280 },
      children: [
        new TextRun({
          text: `TRON QA Suite v3 — quality report. File exported: ${formatReportDate(exportedAtIso)}`,
          italics: true,
          size: 18,
          color: '666666',
          font: 'Calibri'
        })
      ]
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 80 },
      children: [
        new TextRun({
          text: 'https://tronq.vercel.app · Systemset Co · ch.abdul.wahhab@proton.me',
          italics: true,
          size: 18,
          color: '999999',
          font: 'Calibri'
        })
      ]
    })
  );

  const docFile = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: marginTwip,
              right: marginTwip,
              bottom: marginTwip,
              left: marginTwip
            }
          }
        },
        children
      }
    ]
  });

  return Packer.toBuffer(docFile).then((buf) => {
    fs.writeFileSync(outputPath, buf);
  });
}

module.exports = {
  exportToPDF,
  exportToDocx,
  normalizeReport
};
