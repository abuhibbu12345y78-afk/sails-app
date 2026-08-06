import fs from 'fs';

let code = fs.readFileSync('src/components/tracker-app.tsx', 'utf8');

// 1. Replace product-grid in SaleScreen
code = code.replace(
  '<div className="product-grid">',
  '<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">'
);

// 2. Add responsive classes to product-card button
code = code.replace(
  '<button className="product-card"',
  '<button className="product-card w-full min-w-0 max-w-full overflow-hidden"'
);

// 3. Make the product name wrap safely
code = code.replace(
  '<span className="product-name">{product.name}</span>',
  '<h3 className="min-w-0 break-words whitespace-normal text-left font-bold text-[1.05rem] leading-tight text-slate-800 mb-1">{product.name}</h3>'
);

// 4. Update the SaleScreen stock-strip to be responsive and use the exact layout requested
const oldSaleStockStrip = `<div className="stock-strip" style={{ marginTop: '0.75rem', marginBottom: '0.2rem' }}>
          {stock ? (
            <>
              <span>{ml.stock.picked} <strong>{stock.pickedQuantity}</strong></span>
              <span><span className={stock.soldQuantity > 0 ? "highlight-red-bg" : ""}>{ml.stock.sold}</span> <strong className={stock.soldQuantity > 0 ? "highlight-red" : ""}>{stock.soldQuantity}</strong></span>
              <span><span className={stock.remainingQuantity === 0 ? "highlight-red-bg" : ""}>{ml.stock.remaining}</span> <strong className={stock.remainingQuantity === 0 ? "highlight-red" : ""}>{stock.remainingQuantity}</strong></span>
            </>
          ) : (
            <span style={{ gridColumn: 'span 3' }}>{ml.status.notPrepared}</span>
          )}
        </div>`;

const newSaleStockStrip = `<div className="stock-strip" style={{ marginTop: '0.75rem', marginBottom: '0.2rem' }}>
          {stock ? (
            <>
              <div className="min-w-0 text-center">
                <span className="block whitespace-normal break-words text-xs leading-4">{ml.stock.picked}</span>
                <strong className="mt-1 block">{stock.pickedQuantity}</strong>
              </div>
              <div className="min-w-0 text-center">
                <span className={\`block whitespace-normal break-words text-xs leading-4 \${stock.soldQuantity > 0 ? "highlight-red-bg" : ""}\`}>{ml.stock.sold}</span>
                <strong className={\`mt-1 block \${stock.soldQuantity > 0 ? "highlight-red" : ""}\`}>{stock.soldQuantity}</strong>
              </div>
              <div className="min-w-0 text-center">
                <span className={\`block whitespace-normal break-words text-xs leading-4 \${stock.remainingQuantity === 0 ? "highlight-red-bg" : ""}\`}>{ml.stock.remaining}</span>
                <strong className={\`mt-1 block \${stock.remainingQuantity === 0 ? "highlight-red" : ""}\`}>{stock.remainingQuantity}</strong>
              </div>
            </>
          ) : (
            <span style={{ gridColumn: 'span 3' }}>{ml.status.notPrepared}</span>
          )}
        </div>`;

code = code.replace(oldSaleStockStrip, newSaleStockStrip);

// 5. Update other stock-strips across the file
const oldStockStripGeneric = `<div className="stock-strip">
                <span>{ml.stock.picked} <strong>{selectedStock.pickedQuantity}</strong></span>
                <span>{ml.stock.sold} <strong>{selectedStock.soldQuantity}</strong></span>
                <span>{ml.stock.remaining} <strong>{selectedStock.remainingQuantity}</strong></span>
              </div>`;
              
const newStockStripGeneric = `<div className="stock-strip">
                <div className="min-w-0 text-center"><span className="block whitespace-normal break-words text-xs leading-4">{ml.stock.picked}</span><strong className="mt-1 block">{selectedStock.pickedQuantity}</strong></div>
                <div className="min-w-0 text-center"><span className="block whitespace-normal break-words text-xs leading-4">{ml.stock.sold}</span><strong className="mt-1 block">{selectedStock.soldQuantity}</strong></div>
                <div className="min-w-0 text-center"><span className="block whitespace-normal break-words text-xs leading-4">{ml.stock.remaining}</span><strong className="mt-1 block">{selectedStock.remainingQuantity}</strong></div>
              </div>`;

code = code.replace(oldStockStripGeneric, newStockStripGeneric);

const oldStockStripList1 = `<div className="stock-strip"><span>{ml.stock.picked} <strong>{item.pickedQuantity}</strong></span><span>{ml.stock.sold} <strong>{item.soldQuantity}</strong></span><span>{ml.stock.remaining} <strong>{item.remainingQuantity}</strong></span></div>`;
const newStockStripList1 = `<div className="stock-strip"><div className="min-w-0 text-center"><span className="block whitespace-normal break-words text-xs leading-4">{ml.stock.picked}</span><strong className="mt-1 block">{item.pickedQuantity}</strong></div><div className="min-w-0 text-center"><span className="block whitespace-normal break-words text-xs leading-4">{ml.stock.sold}</span><strong className="mt-1 block">{item.soldQuantity}</strong></div><div className="min-w-0 text-center"><span className="block whitespace-normal break-words text-xs leading-4">{ml.stock.remaining}</span><strong className="mt-1 block">{item.remainingQuantity}</strong></div></div>`;

// There are multiple instances of oldStockStripList1, so we split/join
code = code.split(oldStockStripList1).join(newStockStripList1);

// 6. Ensure `Normal Commission` is translated safely (Wait, the user said "Translate examples such as: Commission labels" but also "Do not translate backend data").
// The string is `{money(product.normalCommissionPaise)} Normal Commission`. "Normal Commission" is hardcoded frontend text.
code = code.replace(' Normal Commission', ` {ml.commission.normal}`);

fs.writeFileSync('src/components/tracker-app.tsx', code);
console.log("Patched tracker-app.tsx for responsive stock-strips and grids.");
