'use client';

export default function PrintButton() {
  return (
    <div className="printbar">
      <button onClick={() => window.print()}>Print / Save as PDF</button>
      <span>Use “Save as PDF” in the print dialog to file this note.</span>
    </div>
  );
}
