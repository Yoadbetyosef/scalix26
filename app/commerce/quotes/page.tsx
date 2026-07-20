import { redirect } from 'next/navigation'
// Quotes are unified into Proposals. Legacy quote records remain readable inside the Proposals list.
export default function Page() { redirect('/commerce/proposals') }
