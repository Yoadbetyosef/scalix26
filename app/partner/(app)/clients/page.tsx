import { redirect } from 'next/navigation'

// Retired: "Client Accounts" (reseller framing) → the premium "Businesses" experience.
export default function ClientsRedirect() {
  redirect('/partner/businesses')
}
