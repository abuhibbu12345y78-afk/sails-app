const fs = require('fs');

let fileStr = fs.readFileSync('src/components/tracker-app.tsx', 'utf8');

// Insert import if not present
if (!fileStr.includes('import { ml }')) {
  fileStr = fileStr.replace('import { BusinessDateFilter', 'import { ml } from "../lib/ui-text-ml";\nimport { BusinessDateFilter');
}

const replacements = [
  // Session Labels
  ['"Not Started"', 'ml.status.notStarted'],
  ['"Open"', 'ml.status.open'],
  ['"Previous Day Still Open"', 'ml.status.previousDayStillOpen'],
  ['"Closed"', 'ml.status.closed'],
  
  // Expenses Screen
  ['"Daily Expenses"', 'ml.labels.dailyExpenses'],
  ['"Total Daily Expenses"', 'ml.labels.totalDailyExpenses'],
  ['"Deducted from Company Payable (never reduces commission)"', 'ml.messages.deductedFromCompanyPayable'],
  ['"Standard Expenses"', 'ml.labels.standardExpenses'],
  ['"Petrol Expense (₹)"', 'ml.finance.petrolExpense + " (₹)"'],
  ['"Food Expense (₹)"', 'ml.finance.foodExpense + " (₹)"'],
  ['"Other Expenses"', 'ml.finance.otherExpenses'],
  ['"Description (Optional)"', 'ml.labels.descriptionOptional'],
  ['"Amount (₹)"', 'ml.labels.amount + " (₹)"'],
  ['"Save"', 'ml.actions.save'],
  ['"Saving..."', 'ml.actions.save + "..."'],
  ['"Add"', 'ml.actions.add'],
  ['"Adding..."', 'ml.actions.add + "..."'],
  ['"No other expenses recorded for today."', 'ml.messages.noOtherExpenses'],
  ['"Total Other"', 'ml.labels.totalOther'],
  ['"Added Other Expenses"', 'ml.finance.otherExpenses'],
  
  // Home Summary
  ['"Server time synchronized"', 'ml.messages.serverTimeSynchronized'],
  ['"Time not synchronized"', 'ml.messages.timeNotSynchronized'],
  ['"Business Day: "', 'ml.status.businessDay + ": "'],
  ['"Session earnings"', 'ml.messages.sessionEarningsTitle'],
  
  // Previous Day Warning
  ['"Previous Business Day Is Still Open"', 'ml.status.previousDayStillOpen'],
  ['"Close Previous Day"', 'ml.actions.closePreviousDay'],
  ['"View Previous Day"', 'ml.actions.viewPreviousDay'],
  ['"Gross Sales "', 'ml.finance.grossSales + " "'],
  ['"Normal Commission "', 'ml.finance.normalCommission + " "'],
  ['"Offers Earned "', 'ml.finance.offerEarnings + " "'],
  ['"Total Earnings "', 'ml.finance.totalEarnings + " "'],
  ['"Amount Payable "', 'ml.finance.amountPayable + " "'],
  
  // Drawer / Sale
  ['"Picked "', 'ml.stock.picked + " "'],
  ['"Sold"', 'ml.stock.sold'],
  ['"Remaining "', 'ml.stock.remaining + " "'],
  ['"Selected"', 'ml.labels.selected'],
  ['"Gross Sales"', 'ml.finance.grossSales'],
  ['"Normal Commission "', 'ml.finance.normalCommission + " "'],
  ['"Offers Earned "', 'ml.labels.offersEarned + " "'],
  ['"Total Earnings"', 'ml.finance.totalEarnings'],
  ['"Amount Payable to Company"', 'ml.finance.amountPayableToCompany'],
  
  // Bottom Nav
  ['"Home"', 'ml.navigation.home'],
  ['"Sale"', 'ml.navigation.sale'],
  ['"Dashboard"', 'ml.navigation.dashboard'],
  ['"Offers"', 'ml.navigation.offers'],
  ['"History"', 'ml.navigation.history'],
  ['"More"', 'ml.navigation.more'],

  // App shell
  ['"We couldn’t open the tracker"', 'ml.messages.errorTitle'],
  ['"Try again"', 'ml.actions.tryAgain'],
];

for (const [search, replace] of replacements) {
  // Use regex to replace exact text inside JSX or text nodes. 
  // For JSX text like `<span>Gross Sales <strong>`, we might need finer regex, but doing exact string replace where we can.
  // Actually, replacing `"Home"` could break other code, so we should be careful.
}

console.log("Use a more specific approach if needed.");
