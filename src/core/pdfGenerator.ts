import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AuditReport,
  ClassroomAllocation,
  ExamRecord,
  InstitutionProfile,
  SeatingMode,
  StudentSeatLookup
} from './types';

export type PdfFormat = 'classroom_wise' | 'print_sheet';
export type PdfOrientation = 'portrait' | 'landscape';

export interface GeneratePdfOptions {
  institution: InstitutionProfile;
  exam: ExamRecord;
  roomAllocations: ClassroomAllocation[];
  auditReport: AuditReport;
  seatingMode: SeatingMode;
  format: PdfFormat;
  orientation?: PdfOrientation;
  classroomIdFilter?: string;
}

function formatModeLabel(mode: SeatingMode): string {
  return mode === 1 ? 'One Student Per Bench' : 'Two Students Per Bench';
}

function formatStrategyLabel(strategy: string): string {
  switch (strategy) {
    case 'sequential':
      return 'Sequential Allocation';
    case 'alternate':
      return 'Alternate Roll Number Allocation';
    case 'section_separation':
      return 'Course / Section Separation';
    case 'custom':
      return 'Custom Staggered Rules';
    default:
      return strategy;
  }
}

function drawDocumentHeader(
  doc: jsPDF,
  institution: InstitutionProfile,
  exam: ExamRecord,
  seatingMode: SeatingMode,
  subtitle: string
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  let y = 12;

  // Optional institution logo (printer-friendly top-left)
  let textStartX = marginX;
  if (institution.logoDataUrl && institution.logoDataUrl.startsWith('data:image/')) {
    try {
      const imgType = institution.logoDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(institution.logoDataUrl, imgType, marginX, y, 16, 16);
      textStartX = marginX + 20;
    } catch {
      textStartX = marginX;
    }
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('EXAM PLANNER', textStartX, y + 5);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(subtitle, textStartX, y + 10);

  // Right-aligned Institution details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(institution.name, pageWidth - marginX, y + 5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const fullAddress = `${institution.address}, ${institution.city}, ${institution.state} - ${institution.pinCode}`;
  const addressLines = doc.splitTextToSize(fullAddress, 100);
  doc.text(addressLines, pageWidth - marginX, y + 10, { align: 'right' });

  y += Math.max(20, 10 + addressLines.length * 4);

  // Hairline rule
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 5;

  // Exam metadata grid (printer-friendly light surface, dark text)
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginX, y, pageWidth - marginX * 2, 22, 1.5, 1.5, 'FD');

  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  const col1 = marginX + 3;
  const col2 = marginX + (pageWidth - marginX * 2) * 0.36;
  const col3 = marginX + (pageWidth - marginX * 2) * 0.68;

  doc.setFont('helvetica', 'bold');
  doc.text(`Exam: ${exam.name}`, col1, y + 6);
  doc.text(`Date: ${exam.examDate}${exam.examTime ? ` (${exam.examTime})` : ''}`, col2, y + 6);
  doc.text(`Academic Year: ${exam.academicYear}`, col3, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.text(`Subject: ${exam.subject || 'General'}`, col1, y + 12);
  doc.text(`Class / Course: ${exam.classCourse || 'All'}${exam.semester ? ` · ${exam.semester}` : ''}`, col2, y + 12);
  doc.text(`Mode: ${formatModeLabel(seatingMode)}`, col3, y + 12);

  doc.text(`Strategy: ${formatStrategyLabel(exam.strategy)}`, col1, y + 18);
  doc.text(`Students: ${exam.studentCount}`, col2, y + 18);
  doc.text(`Audit Status: ${exam.latestAuditStatus || 'VERIFIED'}`, col3, y + 18);

  return y + 27;
}

function addFootersAndSignatures(doc: jsPDF, auditReport: AuditReport, includeSignatures: boolean): void {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const generatedDate = new Date().toLocaleString();

  // Add verification summary + signature block on last page if space permits, else new page
  if (includeSignatures) {
    doc.setPage(totalPages);
    const finalY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 60) + 12;
    let sigY = finalY;
    if (sigY + 34 > pageHeight - 18) {
      doc.addPage();
      sigY = 24;
    }

    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(marginX, sigY, pageWidth - marginX * 2, 16, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Verification Summary — Audit Status: ${auditReport.status}   |   Total Students: ${auditReport.totalStudents}   |   Allocated: ${auditReport.allocatedStudents}   |   Unallocated: ${auditReport.unallocatedStudents}   |   Unused Seats: ${auditReport.unusedSeats}`,
      marginX + 3,
      sigY + 6
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Duplicates: ${auditReport.duplicateAssignments}   |   Missing Students: ${auditReport.missingStudents}   |   Total Capacity: ${auditReport.totalCapacity} seats across ${auditReport.activeBenches} active benches`,
      marginX + 3,
      sigY + 12
    );

    const lineY = sigY + 30;
    doc.setDrawColor(100, 116, 139);
    doc.line(marginX, lineY, marginX + 65, lineY);
    doc.line(pageWidth - marginX - 65, lineY, pageWidth - marginX, lineY);

    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Examination Coordinator Signature', marginX, lineY + 5);
    doc.text('Chief Invigilator / Superintendent Signature', pageWidth - marginX, lineY + 5, { align: 'right' });
  }

  const finalPageCount = doc.getNumberOfPages();
  for (let p = 1; p <= finalPageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, pageHeight - 13, pageWidth - marginX, pageHeight - 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Generated using EXAM PLANNER  ·  Seating Allocation Audit: ${auditReport.status}`,
      marginX,
      pageHeight - 8
    );
    doc.text(
      `${generatedDate}  ·  Page ${p} of ${finalPageCount}`,
      pageWidth - marginX,
      pageHeight - 8,
      { align: 'right' }
    );
  }
}

export function buildSeatingPlanPdf(options: GeneratePdfOptions): jsPDF {
  const {
    institution,
    exam,
    roomAllocations,
    auditReport,
    seatingMode,
    format,
    orientation,
    classroomIdFilter
  } = options;

  const filteredRooms = classroomIdFilter
    ? roomAllocations.filter((r) => r.classroomId === classroomIdFilter)
    : roomAllocations;

  const chosenOrientation: PdfOrientation =
    orientation ?? (seatingMode === 2 ? 'landscape' : 'portrait');

  const doc = new jsPDF({
    orientation: chosenOrientation,
    unit: 'mm',
    format: 'a4'
  });

  if (format === 'classroom_wise') {
    let cursorY = drawDocumentHeader(
      doc,
      institution,
      exam,
      seatingMode,
      'EXAMINATION SEATING PLAN — CLASSROOM-WISE ALLOCATION'
    );

    filteredRooms.forEach((room, roomIdx) => {
      if (roomIdx > 0) {
        const pageHeight = doc.internal.pageSize.getHeight();
        if (cursorY > pageHeight - 55) {
          doc.addPage();
          cursorY = 16;
        } else {
          cursorY += 6;
        }
      }

      // Classroom header bar (printer-friendly light slate border, crisp dark text)
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(148, 163, 184);
      doc.rect(14, cursorY, pageWidth - 28, 9, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      const roomLoc = [room.building, room.floor].filter(Boolean).join(' · ');
      doc.text(
        `${room.classroomName.toUpperCase()} (Room ${room.roomNumber})${roomLoc ? ` — ${roomLoc}` : ''}`,
        17,
        cursorY + 6
      );

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(
        `Allocated: ${room.allocatedCount}/${room.capacity}  |  Unused: ${room.unusedSeats}`,
        pageWidth - 17,
        cursorY + 6,
        { align: 'right' }
      );
      cursorY += 12;

      const bodyRows: string[][] = [];
      for (const row of room.rows) {
        for (const bench of row.benches) {
          if (bench.isDisabled) {
            if (seatingMode === 1) {
              bodyRows.push([row.rowLabel, bench.benchLabel, 'DISABLED', 'Bench Disabled']);
            } else {
              bodyRows.push([
                row.rowLabel,
                bench.benchLabel,
                'DISABLED',
                'Bench Disabled',
                'DISABLED',
                'Bench Disabled'
              ]);
            }
          } else if (seatingMode === 1) {
            const s1 = bench.seats[0];
            bodyRows.push([
              row.rowLabel,
              bench.benchLabel,
              s1?.status === 'OCCUPIED' ? (s1.rollNumber ?? '') : 'EMPTY',
              s1?.status === 'OCCUPIED' ? (s1.studentName || 'Name Not Provided') : 'EMPTY'
            ]);
          } else {
            const s1 = bench.seats[0];
            const s2 = bench.seats[1];
            bodyRows.push([
              row.rowLabel,
              bench.benchLabel,
              s1?.status === 'OCCUPIED' ? (s1.rollNumber ?? '') : 'EMPTY',
              s1?.status === 'OCCUPIED' ? (s1.studentName || 'Name Not Provided') : 'EMPTY',
              s2?.status === 'OCCUPIED' ? (s2.rollNumber ?? '') : 'EMPTY',
              s2?.status === 'OCCUPIED' ? (s2.studentName || 'Name Not Provided') : 'EMPTY'
            ]);
          }
        }
      }

      const head =
        seatingMode === 1
          ? [['Row', 'Bench', 'Roll Number', 'Student Name']]
          : [['Row', 'Bench', 'Seat 1 Roll No.', 'Seat 1 Name', 'Seat 2 Roll No.', 'Seat 2 Name']];

      autoTable(doc, {
        startY: cursorY,
        head,
        body: bodyRows,
        theme: 'grid',
        margin: { left: 14, right: 14, bottom: 20 },
        styles: {
          fontSize: 8.5,
          cellPadding: 2.2,
          textColor: [15, 23, 42],
          lineColor: [203, 213, 225],
          lineWidth: 0.25,
          overflow: 'linebreak'
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          lineColor: [148, 163, 184],
          lineWidth: 0.3
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        columnStyles:
          seatingMode === 1
            ? {
                0: { cellWidth: 22 },
                1: { cellWidth: 24 },
                2: { cellWidth: 46, fontStyle: 'bold' },
                3: { cellWidth: 'auto' }
              }
            : {
                0: { cellWidth: 18 },
                1: { cellWidth: 20 },
                2: { cellWidth: 38, fontStyle: 'bold' },
                3: { cellWidth: 'auto' },
                4: { cellWidth: 38, fontStyle: 'bold' },
                5: { cellWidth: 'auto' }
              }
      });

      cursorY =
        ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY) + 4;
    });

    addFootersAndSignatures(doc, auditReport, true);
  } else {
    // PDF Format B: Individual Classroom Print Sheets (each classroom starts on its own page)
    filteredRooms.forEach((room, roomIdx) => {
      if (roomIdx > 0) {
        doc.addPage();
      }

      let cursorY = drawDocumentHeader(
        doc,
        institution,
        exam,
        seatingMode,
        `CLASSROOM PRINT SHEET — ${room.classroomName.toUpperCase()} (Room ${room.roomNumber})`
      );

      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      const roomLoc = [room.building, room.floor].filter(Boolean).join(' · ');
      doc.text(
        `Classroom: ${room.classroomName} (Room ${room.roomNumber})${roomLoc ? ` — ${roomLoc}` : ''}`,
        14,
        cursorY
      );
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(
        `Rows: ${room.rows.length}   |   Active Benches: ${room.activeBenches}   |   Allocated: ${room.allocatedCount} / ${room.capacity}`,
        pageWidth - 14,
        cursorY,
        { align: 'right' }
      );
      cursorY += 4;

      const bodyRows: string[][] = [];
      for (const row of room.rows) {
        for (const bench of row.benches) {
          if (bench.isDisabled) {
            if (seatingMode === 1) {
              bodyRows.push([row.rowLabel, bench.benchLabel, 'DISABLED', 'Bench Disabled']);
            } else {
              bodyRows.push([
                row.rowLabel,
                bench.benchLabel,
                'DISABLED',
                'Bench Disabled',
                'DISABLED',
                'Bench Disabled'
              ]);
            }
          } else if (seatingMode === 1) {
            const s1 = bench.seats[0];
            bodyRows.push([
              row.rowLabel,
              bench.benchLabel,
              s1?.status === 'OCCUPIED' ? (s1.rollNumber ?? '') : 'EMPTY',
              s1?.status === 'OCCUPIED' ? (s1.studentName || 'Name Not Provided') : 'EMPTY'
            ]);
          } else {
            const s1 = bench.seats[0];
            const s2 = bench.seats[1];
            bodyRows.push([
              row.rowLabel,
              bench.benchLabel,
              s1?.status === 'OCCUPIED' ? (s1.rollNumber ?? '') : 'EMPTY',
              s1?.status === 'OCCUPIED' ? (s1.studentName || 'Name Not Provided') : 'EMPTY',
              s2?.status === 'OCCUPIED' ? (s2.rollNumber ?? '') : 'EMPTY',
              s2?.status === 'OCCUPIED' ? (s2.studentName || 'Name Not Provided') : 'EMPTY'
            ]);
          }
        }
      }

      const head =
        seatingMode === 1
          ? [['Row', 'Bench', 'Seat 1 Roll No.', 'Seat 1 Name']]
          : [['Row', 'Bench', 'Seat 1 Roll No.', 'Seat 1 Name', 'Seat 2 Roll No.', 'Seat 2 Name']];

      autoTable(doc, {
        startY: cursorY,
        head,
        body: bodyRows,
        theme: 'grid',
        margin: { left: 14, right: 14, bottom: 20 },
        styles: {
          fontSize: 8,
          cellPadding: 1.4,
          textColor: [15, 23, 42],
          lineColor: [203, 213, 225],
          lineWidth: 0.25,
          overflow: 'linebreak'
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          lineColor: [148, 163, 184],
          lineWidth: 0.3
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        }
      });

      const finalY =
        ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 60) + 14;
      const pageHeight = doc.internal.pageSize.getHeight();
      if (finalY + 14 < pageHeight - 16) {
        doc.setDrawColor(100, 116, 139);
        doc.line(14, finalY, 75, finalY);
        doc.line(pageWidth - 75, finalY, pageWidth - 14, finalY);
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85);
        doc.text('Room Invigilator Signature', 14, finalY + 4.5);
        doc.text('Examination Coordinator Signature', pageWidth - 14, finalY + 4.5, { align: 'right' });
      }
    });

    addFootersAndSignatures(doc, auditReport, false);
  }

  return doc;
}

export function downloadSeatingPlanPdf(options: GeneratePdfOptions): void {
  const doc = buildSeatingPlanPdf(options);
  const safeExamName = options.exam.name.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const suffix =
    options.classroomIdFilter
      ? `_${options.classroomIdFilter}`
      : options.format === 'print_sheet'
      ? '_Print_Sheets'
      : '_Seating_Plan';
  doc.save(`${safeExamName}${suffix}.pdf`);
}

export function exportAllocationsToCsv(
  exam: ExamRecord,
  lookupIndex: StudentSeatLookup[],
  roomAllocations: ClassroomAllocation[]
): void {
  const escapeCsv = (val: string | number | undefined) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = [
    'Roll Number',
    'Student Name',
    'Classroom',
    'Room Number',
    'Row',
    'Bench',
    'Seat',
    'Class',
    'Course',
    'Section',
    'Subject'
  ];

  const lines = [headers.join(',')];
  lookupIndex.forEach((entry) => {
    lines.push(
      [
        escapeCsv(entry.rollNumber),
        escapeCsv(entry.studentName),
        escapeCsv(entry.classroomName),
        escapeCsv(entry.roomNumber),
        escapeCsv(entry.rowLabel),
        escapeCsv(entry.benchLabel),
        escapeCsv(`Seat ${entry.seatNumber}`),
        escapeCsv(entry.className),
        escapeCsv(entry.course),
        escapeCsv(entry.section),
        escapeCsv(entry.subject)
      ].join(',')
    );
  });

  // Also add capacity summary section
  lines.push('');
  lines.push('Classroom Capacity Summary');
  lines.push('Classroom,Room Number,Total Benches,Active Benches,Total Seats,Allocated,Unused');
  roomAllocations.forEach((r) => {
    lines.push(
      [
        escapeCsv(r.classroomName),
        escapeCsv(r.roomNumber),
        r.totalBenches,
        r.activeBenches,
        r.capacity,
        r.allocatedCount,
        r.unusedSeats
      ].join(',')
    );
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeExamName = exam.name.replace(/[^a-zA-Z0-9_-]+/g, '_');
  link.setAttribute('download', `${safeExamName}_Allocation_Report.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
