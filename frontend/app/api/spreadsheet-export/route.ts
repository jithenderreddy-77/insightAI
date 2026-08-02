/**
 * /api/spreadsheet-export — Generate downloadable .xlsx files with formatting.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { data, headers, filename = 'export.xlsx', sheetName = 'Sheet1' } = body as {
      data: Record<string, unknown>[];
      headers: string[];
      filename?: string;
      sheetName?: string;
    };

    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: 'No data to export.' }, { status: 400 });
    }

    if (!headers || !Array.isArray(headers) || headers.length === 0) {
      return NextResponse.json({ error: 'Column headers are required.' }, { status: 400 });
    }

    // Build worksheet from data
    const wsData: any[][] = [headers];
    for (const row of data) {
      const rowArr: any[] = headers.map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        return val;
      });
      wsData.push(rowArr);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Auto-size columns based on content width
    const colWidths = headers.map((h, idx) => {
      let maxLen = h.length;
      for (const row of data.slice(0, 100)) {
        const val = String(row[h] ?? '');
        if (val.length > maxLen) maxLen = val.length;
      }
      return { wch: Math.min(maxLen + 2, 50) };
    });
    ws['!cols'] = colWidths;

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Generate buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Return as downloadable file
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error('[spreadsheet-export] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate the Excel file.' },
      { status: 500 },
    );
  }
}
