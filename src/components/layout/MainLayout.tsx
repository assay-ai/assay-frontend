import { Header } from "./Header";

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex flex-col min-h-screen max-h-screen max-w-screen w-full overflow-hidden bg-01">
      <Header />
      <div className="flex-1 flex-col flex w-full overflow-y-auto">
        {children}
      </div>
    </div>
  );
};

export default MainLayout;