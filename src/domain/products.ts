export interface Product {
  id: string;
  code: string;
  name: string;
  sellingPricePaise: number;
  normalCommissionPaise: number;
  offerEnabled: boolean;
  fullCommissionPaise: number;
  rewardThreshold: number;
  active: boolean;
  sortOrder: number;
  progress: number;
  cycleNumber: number;
}

export const PRODUCT_SEED: Omit<Product, "progress" | "cycleNumber">[] = [
  { id: "ghee-500-ml", code: "ghee-500-ml", name: "Ghee 500 ML", sellingPricePaise: 50000, normalCommissionPaise: 5000, offerEnabled: true, fullCommissionPaise: 50000, rewardThreshold: 12, active: true, sortOrder: 1 },
  { id: "ghee-200-ml", code: "ghee-200-ml", name: "Ghee 200 ML", sellingPricePaise: 23000, normalCommissionPaise: 2500, offerEnabled: true, fullCommissionPaise: 23000, rewardThreshold: 12, active: true, sortOrder: 2 },
  { id: "honey-1-kg", code: "honey-1-kg", name: "Honey 1 KG", sellingPricePaise: 90000, normalCommissionPaise: 10000, offerEnabled: true, fullCommissionPaise: 90000, rewardThreshold: 12, active: true, sortOrder: 3 },
  { id: "honey-500-g", code: "honey-500-g", name: "Honey 500 g", sellingPricePaise: 45000, normalCommissionPaise: 5000, offerEnabled: true, fullCommissionPaise: 45000, rewardThreshold: 12, active: true, sortOrder: 4 },
  { id: "honey-250-g", code: "honey-250-g", name: "Honey 250 g", sellingPricePaise: 25000, normalCommissionPaise: 2500, offerEnabled: true, fullCommissionPaise: 25000, rewardThreshold: 12, active: true, sortOrder: 5 },
  { id: "small-honey-250-g", code: "small-honey-250-g", name: "Small Honey 250 g", sellingPricePaise: 75000, normalCommissionPaise: 5000, offerEnabled: true, fullCommissionPaise: 75000, rewardThreshold: 12, active: true, sortOrder: 6 },
  { id: "koova-250-g", code: "koova-250-g", name: "Koova Powder 250 g", sellingPricePaise: 50000, normalCommissionPaise: 5000, offerEnabled: true, fullCommissionPaise: 50000, rewardThreshold: 12, active: true, sortOrder: 7 },
  { id: "koova-125-g", code: "koova-125-g", name: "Koova Powder 125 g", sellingPricePaise: 25000, normalCommissionPaise: 2500, offerEnabled: true, fullCommissionPaise: 25000, rewardThreshold: 12, active: true, sortOrder: 8 },
  { id: "oil", code: "oil", name: "Oil", sellingPricePaise: 25000, normalCommissionPaise: 1500, offerEnabled: true, fullCommissionPaise: 25000, rewardThreshold: 12, active: true, sortOrder: 9 },
];
