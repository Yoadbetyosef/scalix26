import type { ContextProvider } from './types'
import { catalogProvider } from './providers/catalog'
import { ordersProvider } from './providers/orders'
import { appointmentsProvider } from './providers/appointments'
import { businessInfoProvider } from './providers/business-info'
import { paymentsProvider } from './providers/payments'
import { unavailableProviders } from './providers/unavailable'

// The AI Context Provider registry. Every business module registers itself here — adding a module means
// adding one provider to this list. The Business Brain orchestrator (assembleBusinessContext) consumes this
// dynamically, so NO prompt edits and NO per-channel wiring are ever needed for a new module.
export const PROVIDERS: ContextProvider[] = [
  catalogProvider, // Catalog / Products / Categories / Inventory / Stock / Pricing
  ordersProvider, // Orders / Order status / Tracking
  appointmentsProvider, // Appointments
  paymentsProvider, // Payments (+ closest analog to Invoices)
  businessInfoProvider, // Business hours / Locations  (alwaysOn)
  ...unavailableProviders, // Estimates / Reviews / Promotions (no table yet → declared unavailable)
]
