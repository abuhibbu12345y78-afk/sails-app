import fs from 'fs';

let code = fs.readFileSync('src/components/tracker-app.tsx', 'utf8');

const replacements = [
  // List badges and text
  { search: '<p>Picked {item.pickedQuantity}</p>', replace: '<p>{ml.stock.picked} {item.pickedQuantity}</p>' },
  { search: '<span>Picked <strong>{item.pickedQuantity}</strong></span>', replace: '<span>{ml.stock.picked} <strong>{item.pickedQuantity}</strong></span>' },
  { search: '<span>Sold <strong>{item.soldQuantity}</strong></span>', replace: '<span>{ml.stock.sold} <strong>{item.soldQuantity}</strong></span>' },
  { search: '<span>Remaining <strong>{item.remainingQuantity}</strong></span>', replace: '<span>{ml.stock.remaining} <strong>{item.remainingQuantity}</strong></span>' },
  { search: '<span className="badge">{item.remainingQuantity} remaining</span>', replace: '<span className="badge">{item.remainingQuantity} {ml.stock.remaining}</span>' },
  
  // Similar ones for selectedStock if any
  { search: '<span>Picked <strong>{selectedStock.pickedQuantity}</strong></span>', replace: '<span>{ml.stock.picked} <strong>{selectedStock.pickedQuantity}</strong></span>' },
  { search: '<span>Sold <strong>{selectedStock.soldQuantity}</strong></span>', replace: '<span>{ml.stock.sold} <strong>{selectedStock.soldQuantity}</strong></span>' },
  { search: '<span>Remaining <strong>{selectedStock.remainingQuantity}</strong></span>', replace: '<span>{ml.stock.remaining} <strong>{selectedStock.remainingQuantity}</strong></span>' },

  // Similar ones for product-wise review
  { search: 'Picked {item.pickedQuantity} · Sold {item.soldQuantity} · Remaining {item.remainingQuantity}', replace: '{ml.stock.picked} {item.pickedQuantity} · {ml.stock.sold} {item.soldQuantity} · {ml.stock.remaining} {item.remainingQuantity}' },

  // Total Picked
  { search: 'Total Picked <strong>', replace: '{ml.stock.totalPicked} <strong>' },

  // Product-wise stock review headers
  { search: '<h2>Product-wise stock review</h2>', replace: '<h2>{ml.labels.productWiseStockReview}</h2>' },
  { search: '<p>Review every picked, sold, and remaining quantity.</p>', replace: '<p>{ml.labels.reviewStock}</p>' },

  // Draft editing (Historical)
  { search: '<div>Picked: {pickup[p.id] || 0}</div>', replace: '<div>{ml.stock.picked}: {pickup[p.id] || 0}</div>' }
];

for (const {search, replace} of replacements) {
  code = code.split(search).join(replace);
}

fs.writeFileSync('src/components/tracker-app.tsx', code);
console.log("Patched tracker-app.tsx with Picked, Sold, Remaining translations.");
