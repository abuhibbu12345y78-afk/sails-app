import { createBrowserClient } from '@supabase/ssr'
import { RealtimeService, UnsubscribeFunction } from '../realtime/realtime-service'

export function createRealtimeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export class SupabaseRealtimeService implements RealtimeService {
  private subscribeToTable(table: string, onChange: () => void): UnsubscribeFunction {
    const supabase = createRealtimeClient();
    const channel = supabase
      .channel(`public:${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        onChange();
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }

  subscribeToSales(onChange: () => void): UnsubscribeFunction {
    return this.subscribeToTable('sales', onChange);
  }

  subscribeToProductProgress(onChange: () => void): UnsubscribeFunction {
    return this.subscribeToTable('commission_progress', onChange);
  }

  subscribeToFullCommissions(onChange: () => void): UnsubscribeFunction {
    return this.subscribeToTable('full_commission_rewards', onChange);
  }

  subscribeToDayClosures(onChange: () => void): UnsubscribeFunction {
    return this.subscribeToTable('day_closures', onChange);
  }

  subscribeToDaySessions(onChange: () => void): UnsubscribeFunction {
    return this.subscribeToTable('day_sessions', onChange);
  }

  subscribeToDailyStock(onChange: () => void): UnsubscribeFunction {
    return this.subscribeToTable('day_stock_items', onChange);
  }
}
