import NetInfo from '@react-native-community/netinfo';
import { getOutbox, deleteOutboxById } from './local';
import { Api } from './api';

let started = false;

export function startSync() {
  if (started) return;
  started = true;

  // Run once on start
  trySync();

  // Listen for connectivity changes
  const unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      trySync();
    }
  });

  // Return cleanup if needed (currently not used by callers)
  return unsubscribe;
}

async function trySync() {
  const entries = await getOutbox();
  for (const entry of entries) {
    try {
      switch (entry.type) {
        case 'shop.upsert':
          await Api.createShop(entry.payload);
          await deleteOutboxById(entry.id);
          break;
        case 'invoice.create':
          await Api.createInvoice(entry.payload);
          await deleteOutboxById(entry.id);
          break;
        case 'invoice.delete':
          await Api.deleteInvoice(entry.payload.id);
          await deleteOutboxById(entry.id);
          break;
        default:
          // Unknown type: drop it to avoid blocking the queue forever
          await deleteOutboxById(entry.id);
          break;
      }
    } catch (e) {
      const msg = String((e as any)?.message || e || '');
      // If duplicate/constraint error on invoice.create, drop the entry (already synced earlier)
      if (
        entry.type === 'invoice.create' && (
          msg.includes('duplicate key') ||
          msg.toLowerCase().includes('conflict') ||
          msg.includes('invoices_pkey') ||
          msg.includes('HTTP 409')
        )
      ) {
        await deleteOutboxById(entry.id);
        continue;
      }
      // Leave the entry for a future attempt
      console.warn('Sync item failed, will retry later:', entry.type, e);
    }
  }
}
