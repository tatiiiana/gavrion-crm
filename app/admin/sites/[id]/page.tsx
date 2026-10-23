import SiteEditor from "./site-editor";

export default async function SiteEditorPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return <SiteEditor id={id}/>;
}
