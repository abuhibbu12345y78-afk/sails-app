import fs from 'fs';

function translateFile(filePath) {
  let code = fs.readFileSync(filePath, 'utf8');
  
  if (!code.includes('import { ml }')) {
    code = code.replace('"use client";', '"use client";\nimport { ml } from "../lib/ui-text-ml";');
    if (!code.includes('import { ml }')) {
       // if no use client, just put at top
       code = 'import { ml } from "../lib/ui-text-ml";\n' + code;
    }
  }

  const exactReplacements = [
    // Bottom Nav (exact string literals used in array of objects)
    [/title: "Home"/g, 'title: ml.navigation.home'],
    [/title: "Sale"/g, 'title: ml.navigation.sale'],
    [/title: "Dashboard"/g, 'title: ml.navigation.dashboard'],
    [/title: "Offers"/g, 'title: ml.navigation.offers'],
    [/title: "History"/g, 'title: ml.navigation.history'],
    [/title: "More"/g, 'title: ml.navigation.more'],

    // Expense Screen
    [/>Daily Expenses</g, '>{ml.labels.dailyExpenses}<'],
    [/>Total Daily Expenses</g, '>{ml.labels.totalDailyExpenses}<'],
    [/>Deducted from Company Payable \(never reduces commission\)</g, '>{ml.messages.deductedFromCompanyPayable}<'],
    [/>Standard Expenses</g, '>{ml.labels.standardExpenses}<'],
    [/>Petrol Expense \(₹\)</g, '>{ml.finance.petrolExpense} (₹)<'],
    [/>Food Expense \(₹\)</g, '>{ml.finance.foodExpense} (₹)<'],
    [/>Other Expenses</g, '>{ml.finance.otherExpenses}<'],
    [/>Description \(Optional\)</g, '>{ml.labels.descriptionOptional}<'],
    [/>Amount \(₹\)</g, '>{ml.labels.amount} (₹)<'],
    [/>Save</g, '>{ml.actions.save}<'],
    [/>Saving\.\.\.</g, '>{ml.actions.save}…<'],
    [/>Add</g, '>{ml.actions.add}<'],
    [/>Adding\.\.\.</g, '>{ml.actions.add}…<'],
    [/>No other expenses recorded for today\.</g, '>{ml.messages.noOtherExpenses}<'],
    [/>Total Other</g, '>{ml.labels.totalOther}<'],
    [/>Added Other Expenses \(/g, '>{ml.finance.otherExpenses} (<'],
    
    // Status Labels
    [/Business Day: \{sessionLabel\(state\.daySessionStatus\)\}/g, '{ml.status.businessDay}: {sessionLabel(state.daySessionStatus)}'],
    [/"Not Started"/g, 'ml.status.notStarted'],
    [/"Open"/g, 'ml.status.open'],
    [/"Previous Day Still Open"/g, 'ml.status.previousDayStillOpen'],
    [/"Closed"/g, 'ml.status.closed'],

    // Warning Card
    [/>Previous Business Day Is Still Open</g, '>{ml.status.previousDayStillOpen}<'],
    [/>Close Previous Day</g, '>{ml.actions.closePreviousDay}<'],
    [/>View Previous Day</g, '>{ml.actions.viewPreviousDay}<'],
    [/>Close this Business Day manually before opening /g, '>{ml.messages.closePreviousDayWarning} '],

    // Dashboard & Review
    [/>Gross Sales</g, '>{ml.finance.grossSales}<'],
    [/>Normal Commission \(/g, '>{ml.finance.normalCommission} (<'],
    [/>Offers Earned \(/g, '>{ml.labels.offersEarned} (<'],
    [/>Total Earnings</g, '>{ml.finance.totalEarnings}<'],
    [/>Amount Payable to Company</g, '>{ml.finance.amountPayableToCompany}<'],
    [/>Amount Payable</g, '>{ml.finance.amountPayable}<'],
    [/>Session earnings</g, '>{ml.messages.sessionEarningsTitle}<'],
    
    // Drawer
    [/>Picked /g, '>{ml.stock.picked} '],
    [/>Sold</g, '>{ml.stock.sold}<'],
    [/>Remaining /g, '>{ml.stock.remaining} '],
    [/>Selected</g, '>{ml.labels.selected}<'],
    [/> Save Sale</g, '> {ml.actions.save}<'],

    // App Shell
    [/>We couldn’t open the tracker</g, '>{ml.messages.errorTitle}<'],
    [/> Try again</g, '> {ml.actions.tryAgain}<'],
    [/"The tracker is unavailable\."/g, 'ml.messages.errorTitle'],

    // Start Day / Reopen
    [/>Start New Day</g, '>{ml.actions.startNewDay}<'],
    [/>Reopen Current Day</g, '>{ml.actions.reopenCurrentDay}<'],
    [/>Additional Product Pickup</g, '>{ml.actions.additionalPickup}<'],
    [/>Day Start</g, '>{ml.actions.dayStart}<'],

    // General Buttons
    [/>Back</g, '>{ml.actions.back}<'],
    [/>Confirm</g, '>{ml.actions.confirm}<'],
    [/>Cancel</g, '>{ml.actions.cancel}<'],
    [/>Continue</g, '>{ml.actions.continue}<'],
    [/>Close</g, '>{ml.actions.close}<'],

    // Settings
    [/>Reset Active Business Day</g, '>{ml.actions.resetActiveBusinessDay}<'],
    
    // Day Close
    [/>Day Close</g, '>{ml.actions.dayClose}<'],
    [/>Business Day Closed</g, '>{ml.status.businessDayClosed}<'],

    // Offers
    [/>Offer Earned</g, '>{ml.offers.earned}<'],
    [/>Offer Received</g, '>{ml.offers.received}<'],
    [/>Mark as Received</g, '>{ml.actions.markAsReceived}<'],
    [/>Undo</g, '>{ml.actions.undo}<'],
    [/>Reset to Earned</g, '>{ml.actions.resetToEarned}<'],
    
    // Other Labels
    [/>Quantity</g, '>{ml.labels.quantity}<'],
    [/>Date</g, '>{ml.labels.date}<'],
    [/>Time</g, '>{ml.labels.time}<'],

    // Home / general stock
    [/>Stock</g, '>{ml.stock.stock}<'],
    [/>Low Stock</g, '>{ml.stock.lowStock}<'],
    [/>Shortage</g, '>{ml.stock.shortage}<'],
    [/>Missing Quantity</g, '>{ml.stock.missingQuantity}<'],

    // Business Date Filter
    [/"Today"/g, 'ml.labels.today'],
    [/"Yesterday"/g, 'ml.labels.yesterday'],
    [/"Last 7 Days"/g, 'ml.labels.last7'],
    [/"Specific Date"/g, 'ml.labels.specificDate'],
    [/"Specific Month"/g, 'ml.labels.specificMonth'],
    [/"Previous Month"/g, 'ml.labels.previousMonth'],
    [/"Custom Range"/g, 'ml.labels.customRange'],
    [/"All Time"/g, 'ml.labels.allTime'],
    [/>Filter Business Data</g, '>{ml.actions.applyFilter}<'],
  ];

  for (const [regex, replacement] of exactReplacements) {
    code = code.replace(regex, replacement);
  }

  fs.writeFileSync(filePath, code);
  console.log(`Translated ${filePath}`);
}

const files = [
  'src/components/tracker-app.tsx',
  'src/components/business-date-filter.tsx'
];

for (const file of files) {
  translateFile(file);
}
