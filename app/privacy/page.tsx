export const metadata = {
  title: 'Privacy Policy — Scalix26',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-[#4ecdc4] flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="font-bold text-gray-900 text-lg">Scalix26</span>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Privacy Policy</h1>
          <p className="text-gray-500">Last updated: May 30, 2026</p>
        </div>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Overview</h2>
            <p>
              Scalix26 ("we," "us," or "our") provides an AI-powered customer communication platform
              for home services businesses. This Privacy Policy explains how we collect, use, and
              protect information when you use our services, including SMS communications.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. SMS Messaging</h2>
            <p className="mb-3">
              When you text a business that uses Scalix26, you may receive automated SMS responses
              from our AI assistant on behalf of that business.
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Opt-in:</strong> By texting a Scalix26-powered business number, you consent
                to receive automated SMS responses.
              </li>
              <li>
                <strong>Opt-out:</strong> Reply <strong>STOP</strong> at any time to unsubscribe
                from messages. You will receive one confirmation message and no further messages.
              </li>
              <li>
                <strong>Help:</strong> Reply <strong>HELP</strong> for assistance.
              </li>
              <li>
                <strong>Message frequency:</strong> Message frequency varies based on your
                interactions with the business.
              </li>
              <li>
                <strong>Message and data rates may apply.</strong> Contact your wireless provider
                for details.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Information We Collect</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Phone numbers and message content for SMS communications</li>
              <li>Business contact information provided during account registration</li>
              <li>Usage data and analytics to improve our services</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. No Sharing of Mobile Numbers</h2>
            <p>
              We do not sell, rent, or share your mobile phone number with third parties for
              marketing purposes. Your mobile number is used solely to deliver the SMS communications
              you have requested and to provide our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Security</h2>
            <p>
              We use industry-standard security measures to protect your data, including encryption
              in transit and at rest. We retain conversation data to improve service quality and
              for the business's customer records.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Contact</h2>
            <p>
              For privacy-related questions, contact us at:{' '}
              <a href="mailto:privacy@scalix26.com" className="text-[#4ecdc4] hover:underline">
                privacy@scalix26.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
