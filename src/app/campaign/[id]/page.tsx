import PlayScreen from "./PlayScreen";

export default async function CampaignPage(props: PageProps<"/campaign/[id]">) {
  const { id } = await props.params;
  return <PlayScreen campaignId={id} />;
}
