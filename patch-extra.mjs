import fs from 'fs';

let code = fs.readFileSync('src/components/tracker-app.tsx', 'utf8');

const replacements = [
  // "Sold 0" -> "ml.stock.sold 0"
  // But wait, there are a few variations.
  { search: '<span>Sold <strong>{selectedStock.soldQuantity}</strong></span>', replace: '<span>{ml.stock.sold} <strong>{selectedStock.soldQuantity}</strong></span>' },
  { search: '<span>Sold <strong>{item.soldQuantity}</strong></span>', replace: '<span>{ml.stock.sold} <strong>{item.soldQuantity}</strong></span>' },
  { search: '· Sold {item.soldQuantity} · Remaining {item.remainingQuantity}', replace: '· {ml.stock.sold} {item.soldQuantity} · {ml.stock.remaining} {item.remainingQuantity}' },
  { search: '<span>Total Sold <strong>{state.dashboard.totalUnits}</strong></span>', replace: '<span>{ml.stock.totalSold} <strong>{state.dashboard.totalUnits}</strong></span>' },
  { search: '<span>Previously Picked: {stock?.pickedQuantity ?? 0} · Sold: {stock?.soldQuantity ?? 0} · Remaining: {stock?.remainingQuantity ?? 0}</span>', replace: '<span>{ml.stock.previouslyPicked}: {stock?.pickedQuantity ?? 0} · {ml.stock.sold}: {stock?.soldQuantity ?? 0} · {ml.stock.remaining}: {stock?.remainingQuantity ?? 0}</span>' },
  { search: '`Picked ${stock.pickedQuantity} · Sold ${stock.soldQuantity} · Left ${stock.remainingQuantity}` : "Not prepared"', replace: '`${ml.stock.picked} ${stock.pickedQuantity} · ${ml.stock.sold} ${stock.soldQuantity} · ${ml.stock.left} ${stock.remainingQuantity}` : ml.status.notPrepared' },
  { search: 'label: "Units Sold"', replace: 'label: ml.stock.unitsSold' },
  { search: '<h2>Product-wise stock review</h2>', replace: '<h2>{ml.labels.productWiseStockReview}</h2>' },
  { search: '<p>Review every picked, sold, and remaining quantity.</p>', replace: '<p>{ml.labels.reviewStock}</p>' },
  { search: '<span>Total Units Sold</span>', replace: '<span>{ml.stock.totalUnitsSold}</span>' },
  { search: '<span>Total Units Sold <strong>{state.dashboard.totalUnits}</strong></span>', replace: '<span>{ml.stock.totalUnitsSold} <strong>{state.dashboard.totalUnits}</strong></span>' },
  { search: '<strong>Sold: {sales[p.id] || 0}</strong>', replace: '<strong>{ml.stock.sold}: {sales[p.id] || 0}</strong>' },
  { search: '{item.remainingQuantity} remaining', replace: '{item.remainingQuantity} {ml.stock.remaining}' },
  { search: '<strong>Sold </strong>', replace: '<strong>{ml.stock.sold} </strong>' },
  { search: '> Sold <', replace: '> {ml.stock.sold} <' },
  { search: 'New Total Picked:', replace: 'New Total Picked:' } // Not sure if this needs translation, let's leave it or replace later if requested.
];

for (const {search, replace} of replacements) {
  code = code.split(search).join(replace);
}

// "New Total Picked" and "New Remaining"
code = code.split('New Total Picked:').join('പുതിയതായി ആകെ എടുത്തത്:');
code = code.split('New Remaining:').join('പുതിയ ബാക്കി:');
code = code.split('"Start a business day to prepare daily stock."').join('"പ്രതിദിന സ്റ്റോക്ക് തയ്യാറാക്കാൻ ഒരു ബിസിനസ് ദിവസം ആരംഭിക്കുക."');

fs.writeFileSync('src/components/tracker-app.tsx', code);
console.log("Patched tracker-app.tsx with extra translations.");
