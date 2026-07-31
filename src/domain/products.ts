export interface Product {
  id: string;
  name: string;
  sellingPricePaise: number;
  normalCommissionPaise: number;
  fullCommissionPaise: number;
  rewardThreshold: number;
  progress: number;
  cycleNumber: number;
}

export const PRODUCT_SEED: Omit<Product, "progress" | "cycleNumber">[] = [
  { id: "ghee-500-ml", name: "Ghee 500 ML", sellingPricePaise: 50000, normalCommissionPaise: 5000, fullCommissionPaise: 50000, rewardThreshold: 12 },
  { id: "ghee-200-ml", name: "Ghee 200 ML", sellingPricePaise: 23000, normalCommissionPaise: 2500, fullCommissionPaise: 23000, rewardThreshold: 12 },
  { id: "honey-1-kg", name: "Honey 1 KG", sellingPricePaise: 90000, normalCommissionPaise: 10000, fullCommissionPaise: 90000, rewardThreshold: 12 },
  { id: "honey-500-g", name: "Honey 500 g", sellingPricePaise: 45000, normalCommissionPaise: 5000, fullCommissionPaise: 45000, rewardThreshold: 12 },
  { id: "honey-250-g", name: "Honey 250 g", sellingPricePaise: 25000, normalCommissionPaise: 2500, fullCommissionPaise: 25000, rewardThreshold: 12 },
  { id: "small-honey-250-g", name: "Small Honey 250 g", sellingPricePaise: 75000, normalCommissionPaise: 5000, fullCommissionPaise: 75000, rewardThreshold: 12 },
  { id: "koova-250-g", name: "Koova Powder 250 g", sellingPricePaise: 50000, normalCommissionPaise: 5000, fullCommissionPaise: 50000, rewardThreshold: 12 },
  { id: "koova-125-g", name: "Koova Powder 125 g", sellingPricePaise: 25000, normalCommissionPaise: 2500, fullCommissionPaise: 25000, rewardThreshold: 12 },
  { id: "oil", name: "Oil", sellingPricePaise: 25000, normalCommissionPaise: 1500, fullCommissionPaise: 25000, rewardThreshold: 12 },
];
