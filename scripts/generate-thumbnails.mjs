import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const output = "submission/thumbnails";
await mkdir(output, { recursive: true });

function scene(width, height) {
  const stroke = Math.max(5, Math.round(Math.min(width, height) * 0.008));
  const cx = width / 2;
  const ground = height * 0.78;
  const scoop = Math.min(width, height) * 0.17;
  const coneTop = ground - scoop * 0.5;
  const people = [
    { x: width * 0.2, skin: "#8b553d", hair: "#35283f", shirt: "#735ad7" },
    { x: width * 0.78, skin: "#f1bd91", hair: "#d58c46", shirt: "#36aaa5" },
  ];
  const customer = ({ x, skin, hair, shirt }) => `<g stroke="#35283f" stroke-width="${stroke}" stroke-linejoin="round">
    <path d="M${x - scoop * .7} ${ground} Q${x - scoop * .55} ${ground - scoop * 1.05} ${x} ${ground - scoop * 1.05} Q${x + scoop * .55} ${ground - scoop * 1.05} ${x + scoop * .7} ${ground}" fill="${shirt}"/>
    <circle cx="${x}" cy="${ground - scoop * 1.5}" r="${scoop * .48}" fill="${skin}"/>
    <path d="M${x - scoop * .46} ${ground - scoop * 1.57} Q${x - scoop * .35} ${ground - scoop * 2.05} ${x + scoop * .12} ${ground - scoop * 1.98} Q${x + scoop * .48} ${ground - scoop * 1.85} ${x + scoop * .46} ${ground - scoop * 1.52} Q${x} ${ground - scoop * 1.82} ${x - scoop * .46} ${ground - scoop * 1.57}" fill="${hair}"/>
    <circle cx="${x - scoop * .17}" cy="${ground - scoop * 1.48}" r="${stroke * .65}" fill="#35283f" stroke="none"/><circle cx="${x + scoop * .17}" cy="${ground - scoop * 1.48}" r="${stroke * .65}" fill="#35283f" stroke="none"/>
    <path d="M${x - scoop * .15} ${ground - scoop * 1.34} Q${x} ${ground - scoop * 1.22} ${x + scoop * .15} ${ground - scoop * 1.34}" fill="none" stroke-linecap="round"/>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#91dfc9"/>
    <circle cx="${width * .12}" cy="${height * .18}" r="${Math.min(width,height)*.08}" fill="#ffd45f" stroke="#35283f" stroke-width="${stroke}"/>
    <circle cx="${width * .9}" cy="${height * .3}" r="${Math.min(width,height)*.11}" fill="#ff91ad" stroke="#35283f" stroke-width="${stroke}"/>
    <path d="M0 0H${width}V${height * .12}Q${width * .94} ${height * .22} ${width * .88} ${height * .12}Q${width * .81} ${height * .22} ${width * .75} ${height * .12}Q${width * .69} ${height * .22} ${width * .63} ${height * .12}Q${width * .56} ${height * .22} ${width * .5} ${height * .12}Q${width * .44} ${height * .22} ${width * .38} ${height * .12}Q${width * .31} ${height * .22} ${width * .25} ${height * .12}Q${width * .19} ${height * .22} ${width * .13} ${height * .12}Q${width * .06} ${height * .22} 0 ${height * .12}Z" fill="#fff7e9" stroke="#35283f" stroke-width="${stroke}"/>
    ${people.map(customer).join("")}
    <rect x="${width * .04}" y="${ground}" width="${width * .92}" height="${height - ground + stroke}" rx="${stroke * 3}" fill="#f2b55d" stroke="#35283f" stroke-width="${stroke}"/>
    <g stroke="#35283f" stroke-width="${stroke}" stroke-linejoin="round">
      <path d="M${cx - scoop * .38} ${coneTop}H${cx + scoop * .38}L${cx + scoop * .08} ${ground}H${cx - scoop * .08}Z" fill="#efb552"/>
      <circle cx="${cx - scoop * .06}" cy="${coneTop - scoop * .2}" r="${scoop * .42}" fill="#fff1bd"/>
      <circle cx="${cx + scoop * .18}" cy="${coneTop - scoop * .75}" r="${scoop * .43}" fill="#ff7698"/>
      <circle cx="${cx - scoop * .12}" cy="${coneTop - scoop * 1.25}" r="${scoop * .42}" fill="#72ddb9"/>
      <path d="M${cx - scoop * .45} ${coneTop - scoop * 1.52}Q${cx} ${coneTop - scoop * 1.7} ${cx + scoop * .45} ${coneTop - scoop * 1.5}" fill="none" stroke="#774330" stroke-width="${stroke * 1.5}" stroke-linecap="round"/>
    </g>
    <g fill="#ffd45f" stroke="#35283f" stroke-width="${stroke * .55}"><circle cx="${cx - scoop * .65}" cy="${coneTop - scoop * .85}" r="${stroke * 1.2}"/><circle cx="${cx + scoop * .7}" cy="${coneTop - scoop * 1.2}" r="${stroke * 1.1}"/><circle cx="${cx + scoop * .55}" cy="${coneTop - scoop * .35}" r="${stroke}"/></g>
  </svg>`;
}

const sizes = [
  [1024, 1024, "thumbnail-1x1.png"],
  [1080, 1512, "thumbnail-5x7.png"],
  [1280, 720, "thumbnail-16x9.png"],
];

for (const [width, height, name] of sizes) {
  await sharp(Buffer.from(scene(width, height))).png({ compressionLevel: 9 }).toFile(`${output}/${name}`);
  console.log(`Created ${output}/${name}`);
}
