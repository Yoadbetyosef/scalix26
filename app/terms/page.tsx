export const metadata = {
  title: 'Terms of Service — AI Employee Platform',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-[#4ecdc4] flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Terms of Service</h1>
          <p className="text-gray-500">Last updated: May 30, 2026</p>
        </div>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
            <p>
              By using this platform or communicating with a business powered by our AI, you agree to
              these Terms of Service. If you do not agree, please discontinue use.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Service Description</h2>
            <p>
              We provide AI-powered customer communication tools for home services businesses.
              Our platform enables businesses to respond automatically to customer inquiries via SMS,
              voice, and other messaging channels using artificial intelligence.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. SMS Communications</h2>
            <p className="mb-3">
              By texting a phone number powered by our platform, you agree to the following:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>You are initiating contact and consenting to receive automated SMS replies.</li>
              <li>
                Reply <strong>STOP</strong> to opt out at any time. Reply <strong>HELP</strong> for
                assistance.
              </li>
              <li>Message and data rates may apply based on your carrier plan.</li>
              <li>Message frequency varies based on your interactions.</li>
              <li>
                We are not responsible for delayed or undelivered messages due to carrier issues.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Business Accounts</h2>
            <p>
              Businesses using this platform agree to use it only for lawful customer
              communications. You are responsible for ensuring your use of SMS messaging complies
              with all applicable laws, including the TCPA and CAN-SPAM Act.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. AI Limitations</h2>
            <p>
              Our AI assistant is designed to help with common customer inquiries. Responses are
              generated automatically and may not always be accurate. For urgent matters, always
              contact the business directly. The AI will never diagnose problems, provide medical
              advice, or make legally binding commitments.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Limitation of Liability</h2>
            <p>
              This platform is provided "as is." We are not liable for indirect, incidental, or
              consequential damages arising from your use of our services. Our total liability
              shall not exceed the amount paid by you in the past 12 months.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Changes to Terms</h2>
            <p>
              We may update these terms from time to time. Continued use of our services after
              changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Contact</h2>
            <p>
              Questions about these terms?{' '}
              <a href="mailto:legal@mylocksmithai.com" className="text-[#4ecdc4] hover:underline">
                legal@mylocksmithai.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
