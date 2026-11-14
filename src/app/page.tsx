import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PinLoginView } from "@/components/pin-login-view";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);

  if (session.valid) {
    redirect("/dashboard");
  }

  return <PinLoginView />;
}
