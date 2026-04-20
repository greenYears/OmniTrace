import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders the OmniTrace shell header", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "OmniTrace" })).toBeInTheDocument();
    expect(screen.getByText(/Unified local history viewer/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan / Refresh" })).toBeInTheDocument();
  });
});
