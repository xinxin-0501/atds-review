const { Jimp } = require('jimp');
const path = require('path');
const fs = require('fs');

(async () => {
  const img = await Jimp.read('C:/Users/zenglong/Desktop/1.jpg');
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const sliceH = 1000;
  const outDir = 'd:/Work buddy/2026-08-12-20-19-30/slices';
  await fs.promises.mkdir(outDir, { recursive: true });
  for (let y = 0; y < h; y += sliceH) {
    const h2 = Math.min(sliceH, h - y);
    const slice = img.clone().crop({ x: 0, y, w, h: h2 });
    await slice.write(path.join(outDir, `slice_${String(y).padStart(5, '0')}.jpg`));
  }
  console.log('done');
})();
