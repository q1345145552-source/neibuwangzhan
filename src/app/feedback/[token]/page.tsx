import { FeedbackForm } from "./feedback-form";

interface Props { params: Promise<{ token: string }> }

export default async function FeedbackPage({ params }: Props) {
  const { token } = await params;
  return <FeedbackForm token={token} />;
}

export const dynamic = "force-dynamic";
