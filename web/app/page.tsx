import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import Pipeline from "@/components/Pipeline";
import Benchmark from "@/components/Benchmark";
import CodeDemo from "@/components/CodeDemo";
import IdeShowcase from "@/components/IdeShowcase";
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
        <Features />
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <Pipeline />
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <Benchmark />
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <CodeDemo />
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <IdeShowcase />
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <InstallSection />
      </main>
      <Footer />
      <ScrollReveal />
    </>
  );
}