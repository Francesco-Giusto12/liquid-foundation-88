import { useLocation } from "react-router-dom";

export default function Placeholder() {
  const location = useLocation();
  const name = location.pathname.split("/")[1] || "Page";

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <h1 className="text-2xl font-bold capitalize">{name}</h1>
        <p className="text-muted-foreground mt-2">This page will be built in a follow-up prompt.</p>
      </div>
    </div>
  );
}
