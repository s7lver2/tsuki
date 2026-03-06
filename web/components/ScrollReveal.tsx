"use client";
import { useEffect } from "react";

export default function ScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -60px 0px" }
    );

    els.forEach((el, i) => {
      (el as HTMLElement).style.transitionDelay = `${i * 0.05}s`;
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
