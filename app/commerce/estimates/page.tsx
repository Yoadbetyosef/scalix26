import { redirect } from 'next/navigation'
// Estimates are unified into Proposals. Legacy estimate records remain readable inside the Proposals list.
export default function Page() { redirect('/commerce/proposals') }
