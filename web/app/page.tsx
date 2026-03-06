import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import IdeShowcase from "@/components/IdeShowcase";
import Benchmark from "@/components/Benchmark";
import CodeDemo from "@/components/CodeDemo";
import Features from "@/components/Features";
import Sandbox from "@/components/Sandbox";
import InstallSection from "@/components/InstallSection";
import Footer from "@/components/Footer";
import ScrollReveal from "@/components/ScrollReveal";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <IdeShowcase />
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <Benchmark />
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <CodeDemo />
        <Features />
        <Sandbox />
        <InstallSection />
      </main>
      <Footer />
      <ScrollReveal />
    </>
  );
}
