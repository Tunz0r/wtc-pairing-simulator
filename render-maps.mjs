import fs from 'fs';
import { createCanvas } from 'canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Map page numbers in the PDF to map IDs
// Based on extracted text analysis of WTC-2026-Map-Pack-Lite-2.4-Alt-Release.pdf
const PAGE_MAP = {
  // Hammer and Anvil
  9:  'ha1',
  11: 'ha2',
  13: 'ha3',
  15: 'ha45',
  17: 'ha6',
  19: 'ha7',
  21: 'ha8',
  // Crucible of Battle
  24: 'cb1',
  25: 'cb2',
  26: 'cb3',
  27: 'cb45',
  28: 'cb6',
  29: 'cb7',
  30: 'cb8',
  // Search and Destroy
  32: 'sd1',
  33: 'sd2',
  34: 'sd3',
  35: 'sd45',
  36: 'sd6',
  37: 'sd7',
  38: 'sd8',
  // Dawn of War
  48: 'dow1',
  49: 'dow2',
  50: 'dow3',
  51: 'dow4',
  52: 'dow5',
  53: 'dow6',
  // Sweeping Engagement
  55: 'se1',
  56: 'se2',
  57: 'se3',
  58: 'se4',
  59: 'se5',
  60: 'se6',
};

const SCALE = 1.5; // render quality

async function renderMaps() {
  const pdfPath = 'C:/Users/braem/Downloads/WTC-2026-Map-Pack-Lite-2.4-Alt-Release.pdf';
  const outDir = './maps';

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data }).promise;
  console.log(`PDF has ${doc.numPages} pages`);

  // Provide canvas factory for pdfjs-dist
  const canvasFactory = {
    create(width, height) {
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext('2d') };
    },
    reset(canvasAndContext, width, height) {
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    },
    destroy(canvasAndContext) {
      // noop
    },
  };

  for (const [pageNumStr, mapId] of Object.entries(PAGE_MAP)) {
    const pageNum = parseInt(pageNumStr);
    console.log(`Rendering page ${pageNum} -> ${mapId}.jpg`);

    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: SCALE });

      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      await page.render({
        canvasContext: context,
        viewport,
        canvasFactory,
      }).promise;

      const buffer = canvas.toBuffer('image/jpeg', { quality: 0.8 });
      fs.writeFileSync(`${outDir}/${mapId}.jpg`, buffer);
      console.log(`  -> ${mapId}.jpg (${(buffer.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.error(`  ERROR on page ${pageNum}: ${err.message}`);
    }
  }

  console.log('Done!');
}

renderMaps();
