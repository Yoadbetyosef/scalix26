import { NextResponse } from "next/server";

// Azure publisher-domain verification. Must return application/json at:
// https://<domain>/.well-known/microsoft-identity-association.json
const BODY = JSON.stringify({
  associatedApplications: [
    { applicationId: "557d1ef8-2aed-4161-acde-8cab3cfcb7e0" },
  ],
});

export const dynamic = "force-static";

export function GET() {
  return new NextResponse(BODY, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
