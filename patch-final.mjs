import fs from 'fs';

let code = fs.readFileSync('src/components/tracker-app.tsx', 'utf8');

const replacements = [
  // Dashboard & Home Screens
  { search: '"No business day has been started today."', replace: 'ml.messages.noBusinessDayStarted' },
  { search: 'No business day has been started today.', replace: '{ml.messages.noBusinessDayStarted}' },
  { search: '>OPEN NEW DAY<', replace: '>{ml.actions.openNewDay}<' },
  { search: '>VIEW DAY SUMMARY<', replace: '>{ml.actions.viewDaySummary}<' },
  { search: '>OPEN WHATSAPP REPORT<', replace: '>{ml.actions.openWhatsappReport}<' },
  { search: '>REOPEN CURRENT DAY<', replace: '>{ml.actions.reopenCurrentDayCaps}<' },
  { search: '>RESET CURRENT DAY<', replace: '>{ml.actions.resetCurrentDayCaps}<' },
  { search: 'The calendar date has changed', replace: '{ml.messages.calendarDateChanged}' },
  { search: 'What would you like to do?', replace: '{ml.messages.whatWouldYouLikeToDo}' },
  { search: 'Choose an action to get started.', replace: '{ml.messages.chooseActionToGetStarted}' },
  { search: 'End of day', replace: '{ml.messages.endOfDay}' },
  { search: 'Review totals before closing.', replace: '{ml.messages.reviewTotalsBeforeClosing}' },
  { search: '>Current Time<', replace: '>{ml.labels.currentTime}<' },
  { search: '>Working Duration<', replace: '>{ml.labels.workingDuration}<' },
  
  // Day Start & Additional Pickup
  { search: 'Select today’s picked quantities', replace: '{ml.messages.selectTodaysPickedQuantities}' },
  { search: 'Products left at 0 are not picked today.', replace: '{ml.messages.productsLeftAt0NotPicked}' },
  { search: '>Confirm & Start Day?<', replace: '>{ml.messages.confirmAndStartDay}<' },
  { search: 'A new Business Day will be created only after this confirmation. Previous quantities and remaining stock are not copied.', replace: '{ml.messages.newBusinessDayCreatedAfterConfirmation}' },
  { search: 'Products Selected', replace: '{ml.labels.productsSelected}' },
  { search: 'Total Picked Units', replace: '{ml.labels.totalPickedUnits}' },
  { search: 'All products will start at zero picked quantity.', replace: '{ml.messages.allProductsStartAtZero}' },
  { search: 'Original pickup remains unchanged in history. Add only new quantities.', replace: '{ml.messages.originalPickupUnchanged}' },
  { search: 'Pickup reason', replace: '{ml.labels.pickupReason}' },
  { search: '>CONFIRM ADDITIONAL PICKUP<', replace: '>{ml.actions.confirmAdditionalPickupCaps}<' },
  { search: 'Review the new quantities before saving this audited stock adjustment.', replace: '{ml.messages.reviewNewQuantitiesBeforeSaving}' },
  { search: 'Total Additional Units', replace: '{ml.labels.totalAdditionalUnits}' },
  { search: 'New Total Picked:', replace: '{ml.labels.newTotalPicked}:' },
  { search: 'New Remaining:', replace: '{ml.labels.newRemaining}:' },
  { search: '>Additional Product Pickup<', replace: '>{ml.actions.additionalPickup}<' },
  
  // Sale & Offers
  { search: 'CHOOSE A PRODUCT', replace: '{ml.messages.chooseAProduct}' },
  { search: 'Next: Offer', replace: '{ml.labels.nextOffer}' },
  { search: '>Commission Progress<', replace: '>{ml.labels.commissionProgress}<' },
  { search: 'Persistent Commission Progress', replace: '{ml.labels.persistentCommissionProgress}' },
  { search: 'Day Start and Day Close never reset these cycles.', replace: '{ml.messages.dayStartAndCloseNeverReset}' },
  { search: 'Filtered Offers Earned', replace: '{ml.labels.filteredOffersEarned}' },
  { search: 'Offer Records', replace: '{ml.labels.offerRecords}' },
  { search: 'Tap an EARNED offer to mark as received.', replace: '{ml.messages.tapEarnedOfferToMarkReceived}' },
  { search: 'Tap to mark as received', replace: '{ml.messages.tapToMarkReceived}' },
  { search: '>Mark this Offer as Received?<', replace: '>{ml.messages.markOfferAsReceived}<' },
  { search: 'Confirm that you have actually received this Offer. This will change the Offer status from EARNED to RECEIVED.', replace: '{ml.messages.confirmActuallyReceivedOffer}' },
  { search: '>Undo Received Status?<', replace: '>{ml.messages.undoReceivedStatus}<' },
  { search: 'This will change the Offer back from RECEIVED to EARNED.', replace: '{ml.messages.changeOfferBackToEarned}' },
  { search: '<th>Product</th>', replace: '<th>{ml.labels.product}</th>' },
  { search: '<th>Offer Value</th>', replace: '<th>{ml.labels.offerValue}</th>' },
  { search: '<th>Cycle Number</th>', replace: '<th>{ml.labels.cycleNumber}</th>' },
  { search: '<th>Earned Date/Time</th>', replace: '<th>{ml.labels.earnedDateTime}</th>' },
  
  // Day Close & History
  { search: 'Review the previous day&apos;s stock and financial details before closing it. After closing, no additional sales can be added unless the day is formally reopened.', replace: '{ml.messages.reviewPreviousDayBeforeClosing}' },
  { search: '>Sales History<', replace: '>{ml.labels.salesHistory}<' },
  { search: '>Closed Business Days<', replace: '>{ml.labels.closedBusinessDays}<' },
  { search: 'Tap to view full closure summary', replace: '{ml.messages.tapToViewFullClosureSummary}' },
  { search: 'Business Day Closure Summary', replace: '{ml.labels.businessDayClosureSummary}' },
  { search: 'Session summary', replace: '{ml.labels.sessionSummary}' },
  { search: '>Add / Edit Expenses<', replace: '>{ml.labels.addEditExpenses}<' },
  { search: '>Salesperson Earnings<', replace: '>{ml.finance.salespersonEarnings}<' },
  { search: '>Company Payable<', replace: '>{ml.finance.companyPayable}<' },
  { search: '>Copy Message<', replace: '>{ml.messages.copyMessage}<' },
  { search: '>(Edit)<', replace: '>{ml.labels.edit}<' },
  
  // Warnings & Settings
  { search: 'Expenses can only be added to an active business day. Start a day to record expenses.', replace: '{ml.messages.expensesCanOnlyBeAddedToActive}' },
  { search: 'Calendar date changed', replace: '{ml.messages.calendarDateChanged}' },
  { search: 'Close the previous business day before recording new sales.', replace: '{ml.messages.closePreviousDayWarning}' },
  { search: '>Reopen Current Business Day?<', replace: '>{ml.messages.reopenCurrentBusinessDay}<' },
  { search: 'This Business Day has already been closed. Reopening it will allow additional product pickup and new sales. Existing records remain unchanged; the previous close summary and WhatsApp report become outdated.', replace: '{ml.messages.businessDayAlreadyClosedReopen}' },
  { search: '>Reset Current Business Day?<', replace: '>{ml.messages.resetCurrentBusinessDay}<' },
  { search: 'Are you sure you want to completely wipe the current Business Day?', replace: '{ml.messages.sureYouWantToWipeBusinessDay}' },
  { search: 'This will permanently delete the day session, all stock tracking, and reset the state as if the day was never started.', replace: '' },
  { search: '>Cancel Historical Draft?<', replace: '>{ml.messages.cancelHistoricalDraft}<' },
  { search: 'All unsaved draft data will be discarded. Confirmed historical records already saved to the database will not be affected.', replace: '{ml.messages.allUnsavedDraftDataDiscarded}' },
  { search: '>KEEP EDITING<', replace: '>{ml.actions.keepEditing}<' },
  { search: '>DISCARD DRAFT<', replace: '>{ml.actions.discardDraft}<' },
  { search: '>SELECT PAST BUSINESS DATE<', replace: '>{ml.actions.selectPastBusinessDate}<' },
  { search: 'Next: Stock Pickup', replace: '{ml.labels.nextStockPickup}' },
  { search: '>CANCEL DRAFT<', replace: '>{ml.actions.cancelDraft}<' },
  { search: 'Next: Sales', replace: '{ml.labels.nextSales}' },
  { search: 'Next: Review', replace: '{ml.labels.nextReview}' },
  { search: '>Salesman name<', replace: '>{ml.labels.salesmanName}<' },
  { search: '>Business name<', replace: '>{ml.labels.businessName}<' },
  { search: '>WhatsApp report number<', replace: '>{ml.labels.whatsappReportNumber}<' },
  { search: '>Business timezone<', replace: '>{ml.labels.businessTimezone}<' },
  { search: '>Live refresh<', replace: '>{ml.labels.liveRefresh}<' },
  { search: '>Keep totals up to date<', replace: '>{ml.labels.keepTotalsUpToDate}<' },
  { search: '>Previous Business Data<', replace: '>{ml.labels.previousBusinessData}<' },

  // Missing stuff
  { search: 'New day unavailable', replace: '{ml.messages.newDayUnavailable}' },
  { search: 'Additional pickup unavailable', replace: '{ml.messages.additionalPickupUnavailable}' },
  { search: 'Reopen the trusted current Business Day first.', replace: '{ml.messages.reopenTrustedBusinessDayFirst}' },
  { search: '>Daily Stock<', replace: '>{ml.messages.dailyStock}<' },
  { search: 'Stock resets only when a new day is manually started.', replace: '{ml.messages.stockResetsOnlyWhenNewDayStarted}' },
  { search: 'Record petrol, food, and other costs', replace: '{ml.messages.recordPetrolFoodAndOtherCosts}' },
  { search: '>Original Start<', replace: '>{ml.messages.originalStart}<' },
  { search: '>Original Close<', replace: '>{ml.messages.originalClose}<' },
  { search: '>Total Picked<', replace: '>{ml.messages.totalPicked}<' },
  { search: '>Total Sold<', replace: '>{ml.messages.totalSold}<' },
  { search: '>Total Remaining<', replace: '>{ml.messages.totalRemaining}<' },
  { search: 'Mandatory reopen reason', replace: '{ml.messages.mandatoryReopenReason}' },
  { search: 'Reset Active Business Day?', replace: '{ml.messages.resetActiveBusinessDayQ}' },
  
  { search: '>AL QUWWA<', replace: '>{ml.labels.alQuwwa}<' },
  { search: 'Previous Business Date', replace: '{ml.labels.previousBusinessDate}' },
  { search: '>VIEW PREVIOUS DAY<', replace: '>{ml.labels.viewPreviousDayCaps}<' },
  { search: '>CLOSE PREVIOUS DAY<', replace: '>{ml.labels.closePreviousDayCaps}<' },

  { search: 'Started', replace: '{ml.labels.started}' },
  { search: 'Reopened', replace: '{ml.labels.reopened}' },
  { search: 'Business Date', replace: '{ml.labels.businessDate}' },
  { search: '>CLOSED<', replace: '>{ml.status.closedCaps}<' }
];

for (const {search, replace} of replacements) {
  // Be careful with replacement when spacing or exact tags matter
  code = code.split(search).join(replace);
}

// Ensure wipe warning makes sense (since we removed the second half above)
code = code.split('{ml.messages.sureYouWantToWipeBusinessDay}\n            ').join('{ml.messages.sureYouWantToWipeBusinessDay}');
code = code.split('{ml.messages.sureYouWantToWipeBusinessDay}            ').join('{ml.messages.sureYouWantToWipeBusinessDay}');
code = code.split('{ml.messages.sureYouWantToWipeBusinessDay}           ').join('{ml.messages.sureYouWantToWipeBusinessDay}');

fs.writeFileSync('src/components/tracker-app.tsx', code);
console.log("Patched tracker-app.tsx with final comprehensive translations.");
